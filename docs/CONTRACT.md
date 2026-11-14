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
                       //   showRoomLabels, showSite, showItems, showRoof, wallsCutaway, timeOfDay, leftPanel, rightPanel, catalogZone,
                       //   date, sunStudy, daylight, daylightSky:'clear'|'overcast', lights:'auto'|'on'|'off' }
store.project          // { name, ceilingHeight (cm, 300), roof:'flat', wallColor, exteriorColor, frameColor }
store.finishes         // { [spaceId]: { floor?: productId, wall?: productId } }
store.addItem(partial) / addItems([...]) / updateItem(id, patch, {transient}) / updateItems(ids, patch|fn)
store.removeItems(ids) / duplicateItems(ids) / swapItem(id, partial) / bringToFront(ids) / sendToBack(ids)
store.select(ids) / toggleSelect(id) / clearSelection() / getItem(id) / getSelected() / spaceOf(item)
store.setUI(patch) / setProject(patch) / setFinish(spaceId, patch)
store.begin() … store.commit() / store.cancel()     // one undo step for a whole drag
store.undo() / redo() / historyState()
store.serialize() / load(data) / saveLocal() / loadLocal() / clearLocal()
store.on('items'|'selection'|'ui'|'project'|'finishes'|'plan'|'history'|'load', fn) → unsubscribe   // 'plan': see § 7
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

#### Several floors in 3D (stage F3, additive; plans without `levels` render exactly as before)
* **Stacking** (`view3d/house.js`): every level is built by the one-storey grid builder on `levelPlan(PLAN, id)` and placed
  at Y = elevation / 100 (group `level:<id>`, `userData.levelId`). Walls of a level under another one stop at that
  level's slab; the slab under level k ≥ 1 (mesh `slab`) = its footprint minus its voids, `heights.slab` thick; the roof
  of each level = its footprint minus the footprint of the level above (top level: all of it), parapet + coping on the
  open edges only — a smaller upper level leaves a terrace roof below. Voids cut the upper floor finish and the
  ceiling below and get a guard rail (mesh `railing`, 1.05 m, posts + top / mid / bottom rail, 5 cm onto the floor;
  the edge facing a `void.stair`'s arrival direction stays open — `stairArrivalDir(stair)` of `core/stairs.js` since F4a,
  derived from `rot` / `shape` / `turn`, a stored `up` is ignored; no stair → all round). Plinth / ground contact: L0 only. Upper-level wall ids contain `|` — mesh names use room ids only.
* **House API** (internal, additive): `rebuildPlan(e?)` (L0 on its own edits, an upper level when its arrays / heights /
  voids changed or `e.levelId` names it, a level's roof alone when only the footprint above moved; no `e` = all),
  `setLevel(id)`, `setWholeHouse(bool)`, `viewLevel()`, `levels()` → `[{ id, y, wallTop, top, visible }]` (m),
  `levelOfObject(obj)`. The daylight hooks (`setDaylight`, `forEachInterior`, `setFakeShading`) act on L0 only.
* **View** (`createView3D`): follows `store.ui.level` — levels above it are hidden with their items (with the sun study on,
  shadow-only stand-ins of them keep blocking the sun), the shown level follows the roof / cut-away controls, levels
  below are complete. `view3d.setWholeHouse(bool)` / `getWholeHouse()` (event `'whole-house' { on }`): every level, the
  top one following roof / cut-away; turning it on also turns the roof on. A pill at the top centre of the 3D view
  ("First floor · Show whole house") appears only for plans with levels (orbit mode). Walk mode shows every level.
  `debug.levels()` → `{ list, shown, view, whole, walk }`.
* **Items**: `Y += elevation` of `item.level` (a carpentry unit without `level`: its run's `level`); picking, drag and
  drop land on the floor of the level under the pointer (empty space → the shown level's floor), a dragged item stays
  on its level, a new item gets `level` (absent for L0) and an upper level's ceiling for ceiling placement; the
  project's ceiling height (L0's) no longer moves ceiling items of upper levels. Carpentry: section-cut walls and the
  hidden corridor come from the run's level.
* **Walk**: starts on the shown level (`walk.start({ level })`; an upper level: the middle of its largest room) and
  stays there — floor height = the level's elevation (eye 1.65 m above it), walls and furniture of that level only.
  `'walk-position'` carries `level` when it is not L0. Stairs: stage F5.
* **Lighting of upper levels in this stage** (the solver is L0-only until F6): while an upper level is shown (not the
  whole house) or walked, the daylight display is suppressed (`suppress`), i.e. the standard "realistic daylight off"
  lighting: sun with shadows, sky fill, the interior fill lights of the walker's / camera's level (environment anchors
  per level), and the baked contact-shading strips, which upper levels always keep. Furniture above the ground-floor
  ceiling never reads the L0 probe field (`dlFieldBox.w` = the top of the solve; 0 = no limit, one-level plans), lamps
  up there are lit by the real-time lamp pool, and upper-level items are not solver occluders. An edit on an upper level
  does not re-solve the ground floor. Shadow box and sun-study casters cover the full height.
* Camera presets and the target clamp use the total height; a room preset of an upper level frames that floor.
* Tests: `node tests/levels-3d.test.mjs` (headless: Duplex stacking, slab / void / roof / terrace / railing, items,
  walk, rebuild rules, disposal, House 98 mesh hashes vs `tests/fixtures/house98-mesh-hashes.json`, performance);
  `node tests/levels-3d.e2e.mjs [--shots]` (browser, `?levels=1`).

#### 3D lighting: sky, lamps, furniture (additive)
* `store.ui.daylightSky: 'clear' | 'overcast'` — read by `environment.js` (`env.setSky(type)`: overcast = no direct sun, grey
  dome, sky fill scaled by the overcast / clear diffuse ratio, +0.7 EV) and by the daylight solver (CIE overcast sky, no sun).
* `store.ui.daylight: boolean` — the radiosity daylight solver on / off (off = the simple fill lights).
* `store.ui.lights: 'auto' | 'on' | 'off'` (default `'auto'`: lamps on below 2° of sun elevation, 7° when overcast). Lit,
  switched-on (`params.on !== false`) lighting items glow (emissive) and, indoors, are **emitters of the daylight solve**
  (`view3d/daylight/lamps.js`: `lampSpec(item) → { lm, lobe, down, color, kelvin } | null`, typical lumen class per type /
  variant, 2700 K unless `params.lumens|lm`, `params.cct|kelvin` or `params.lightColor` say otherwise). Garden lamps (and
  every lamp when the solver is off / failed) use the fixed 8-light real-time pool.
* Big furniture blocks bounced light, sky and sun in the solver: `lamps.js` `occluderBox(item, baseY) → { id, corners, y0, y1 } | null`
  for `OCCLUDER_TYPES` (wardrobes, cabinets, kitchen units, appliances, beds and sofas by their body height, …). Boxes are
  sent to the worker 300 ms after the last item change; only the rooms whose boxes changed are gathered again.
* Direct sun: `environment.js` takes the beam strength from the solver's model (`daylight/sky.js` `sunNormalLux`, exported as
  `sunIntensityAt(alt)`); indoors (lightmapped surfaces, furniture in the probe field) it is × the glazing transmittance the
  solver uses for sky light (`DEFAULTS.glass`, 0.78).
* All three options are in the sun panel (`src/ui/sun.js`, expanded) and are saved with the design like the other `store.ui` view options.
* Items layer (internal, additive): `items.setLampsLit(bool)`, `items.lampPoints() → [{ id, points: [[x, y, z] m] }]`,
  `items.updateLamps(camera, enabled, skip?)` (`skip(id, x, y, z)` → leave that lamp to the solver).
* Solver (internal, additive): `setOccluders(S, boxes)`, `occluderRegions(S, box, set)`, `receiversFor(S, regions)`,
  `createVisibilityJob(S, { base, redo })` (incremental pass), `relight(S, vis, { …, lamps: [{ x, y, z, lm, color, lobe?, down? }] })`
  → adds `lamp` (direct lamp irradiance per patch) and `lampStats`; engine message `{ type: 'occluders', boxes }`.
  Daylight controller: `setLampsLit(bool)`, `solvesLamp(id)`, `onItems()`; `debug.state()` adds lamp / occluder / gain fields.

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

## 7. Plan editing API (`src/core/plan-edit.js`) — core, pure logic (no DOM, no THREE)

The owner may change interior walls, doors and windows "based on what is allowed". All of it goes through this module.

**Model.** `PLAN` stays ONE shared object. An edit REPLACES `PLAN.walls`, `PLAN.openings`, `PLAN.rooms` and
`PLAN.wallOutline` with new arrays (never mutates them in place) and the store then emits
`'plan' { reason, changed: { walls: bool, openings: bool, rooms: bool }, transient?: bool }`.
`reason`: `'add-wall' | 'remove-wall' | 'move-wall' | 'resize-wall' | 'add-opening' | 'update-opening' | 'remove-opening' |
'update-room' | 'reset' | 'history'` (undo / redo / cancel) `| 'load'`.
**Views:** on `'plan'` rebuild everything drawn from `PLAN` (walls, openings, floors, room labels, dimensions, snapping,
collision, checks); read `PLAN.walls` etc. at the time of use and never keep those arrays. `geometry.wallFaces()` is
already invalidated (`invalidatePlanCaches()`), `walkBlockers()` / `spaceAt()` read `PLAN` live.
Plan space as in § 1; every edit is axis-aligned and snapped to a **5 cm grid**.

```js
import { BASE_PLAN, wallSegments, segmentAt, openingPolicy, canAddWall, canAddOpening,
         addWall, removeWallSegment, moveWallSegment, resizeWallSegment,
         addOpening, updateOpening, removeOpening, flipDoor, updateRoom,
         resetPlan, planDiff, isPlanModified, REASONS } from './core/plan-edit.js';
```

### Classification and policy (decided by the owner)
Computed from geometry on every plan (the `kind` strings of the architect's data are not trusted):

| `cls` | what | wall `policy.level` | openings in it |
| --- | --- | --- | --- |
| `mamad` | any wall inside the safe-room shell (room `mamad` grown to the outer faces of its walls, + the architect's other `mamad` walls) | `'locked'` | `win-mamad`, `door-mamad` (incl. `innerDoor`): `'locked'` |
| `exterior` | wall that touches the outdoors (flood-fill from outside; terrace, porch, utility yard are outdoors) | `'locked'` — cannot be added, moved, removed | `'permit'`: move, resize, sill / height, add, remove (→ filled with wall). Re-hanging / style only: `'free'` |
| `thick` | interior wall ≥ 15 cm that was on the architect's plan | `'warn'` | `'free'` |
| `partition` | interior wall < 15 cm, and every wall the owner drew (7–20 cm) | `'free'` | `'free'` |

Reason texts: `REASONS.mamad` ("… prohibited by the Civil Defence (shelter specifications) regulations."),
`REASONS.exteriorWall`, `REASONS.permit` ("Changing an exterior opening requires a building-permit amendment."),
`REASONS.thick(t)` ("This 20 cm wall may be structural — confirm with your structural engineer before changing it.").
Levels order: `free < warn < permit < locked`. A `'locked'` operation is refused; `'warn'` / `'permit'` operations are
carried out and the text comes back in `warnings` — the UI decides whether to ask first (use the dry runs / `policy`).

### Queries
```js
BASE_PLAN                                   // deep-frozen base plan (same shape as PLAN; House 98 = the architect's) — for diffing; changes only when a project is opened (§ 10)
wallSegments(plan = PLAN) → Segment[]       // cached per plan revision; treat as read-only
segmentAt(x, y, tol = 6) → Segment | null   // hit-test (nearest segment rectangle within tol cm)
openingPolicy(openingId) → { level: 'free' | 'permit' | 'locked', reason }
isPlanModified() → boolean
planDiff() → { changed: boolean, items: [{ kind, level, text, at: { x, y }, ref }] }
//   kind: 'wall-added' | 'wall-removed' | 'wall-moved' | 'opening-added' | 'opening-removed' | 'opening-changed'
//   level: 'free' | 'warn' | 'permit';  text: one English sentence;  at: plan point to flag;  ref: segment id or opening id
//   Compared with BASE_PLAN. Doors that travel with a moved wall and walls stretched to follow it are not listed separately.

Segment = {
  id,                    // stable, from geometry: 'seg:v:<x>:<y0>:<y1>' | 'seg:h:<y>:<x0>:<x1>' (core coordinates)
  axis: 'h' | 'v',       // direction the wall runs
  x, y, w, h,            // rectangle to draw / hit-test. Segments tile the wall solids (walls + openings) exactly once,
                         // so this is the core plus the junction squares handed to this segment
  core: { x, y, w, h },  // the stretch between the junctions / wall ends — what remove / move / resize act on
  thickness, length,     // cm (length of x,y,w,h along the axis)
  cls: 'partition' | 'thick' | 'exterior' | 'mamad',
  policy: { level: 'free' | 'warn' | 'locked', reason },
  openingIds: string[],  // doors / windows in this segment
  isNew: boolean,        // not on the architect's plan (drawn or moved by the owner)
  between: [a, b],       // space ids on its two faces: [north | west side, south | east side] (room id, outdoor-area id, 'outside')
  freeEnds: [bool, bool] // start / end of the core is a free wall end
}
```
A segment = a maximal straight stretch of wall, **including the openings in it**, between junctions with perpendicular
walls / wall ends / changes of thickness. A T-junction therefore splits the through wall into two segments. Ids only
change when a junction on that wall appears or disappears.

### Dry runs (live feedback while drawing / dragging; never change anything)
```js
canAddWall({ x1, y1, x2, y2, thickness }) → { ok: true, rect: { x, y, w, h }, level: 'free' } | { ok: false, reason }
canAddOpening({ kind, x, y, width })      → { ok: true, segmentId, rect, level: 'free' | 'permit' } | { ok: false, reason }
```

### Mutations
Each returns `{ ok: true, level, warnings: string[], ids: string[] }` or `{ ok: false, reason }` (plain English, show
it to the user). A refused call changes nothing. A successful call = one undo step + one `'plan'` event; a call that
changes nothing returns `ok: true` without either. All take a last optional argument `opts = { transient: true }`
for use inside `store.begin() … store.commit() / cancel()` (a drag = one undo step, no autosave per mouse move).
```js
addWall({ x1, y1, x2, y2, thickness = 10 })   // ids = new segment ids
//   (x1,y1)-(x2,y2) = centre line; the smaller delta is dropped (axis-aligned); thickness 7–20 cm.
//   Each end is trimmed back to the face of a wall it starts inside, or extended to a wall face ≤ 15 cm away.
//   Refused: < 30 cm long, outdoors, inside the mamad, crossing an exterior / mamad wall, through or ending on an
//   opening, along / on top of another wall, leaving a space < 60 cm or < 10 cm of wall beside an opening.
//   May cross unlocked interior walls (X junction) and may be free-standing.
removeWallSegment(segmentId)                  // removes the core and the openings in it; junction squares stay with
                                              // the walls that meet there (clean ends). Rooms merge.
moveWallSegment(segmentId, delta)             // sideways, cm (+ = east / south), snapped. Its openings travel with it.
                                              // Free doors / passages in a wall it ends on, within 20 cm of its face, travel too (keeping their
                                              // jamb) and appear in planDiff as moved; exterior and safe-room openings never travel.
//   Walls it met at its ends follow: a wall that ended on it stretches / shrinks, a wall it stands on is slid along
//   (and stretched if it moves past that wall's end). Refused if it would cross another wall, leave the house, end
//   on an opening, leave a space < 60 cm or a free wall stub < 30 cm.  ids = the moved segment's new id(s)
resizeWallSegment(segmentId, { start, end })  // new start / end along its axis (plan cm; omit = keep); trimmed /
                                              // extended like addWall; shortening a joined end must leave ≥ 60 cm
addOpening({ kind, x, y, width, height, sill, style, hinge, swing })       // ids = [new opening id]
//   kind 'door' (80 × 210, style 'interior'; in an exterior wall 'service') | 'window' (100 × 100, sill 110, style
//   'sliding'; exterior walls only) | 'sliding-door' (160 × 210, 'glass-sliding') | 'opening' = door-less passage
//   (90 × 210, style 'open', interior walls only, no hinge / swing).  (x, y) = wanted centre; it lands in the
//   nearest wall segment within 60 cm, clamped ≥ 10 cm from the segment ends and other openings.
//   Door defaults: hinge on the jamb nearer a wall end, swing into the smaller room.  New ids: 'door-new-n' | 'win-new-n' | 'pass-new-n'.
updateOpening(id, patch)
//   patch: { offset (cm from the start of its segment core) | x, y (wanted centre) — slides along its own segment,
//   clamped as above;  width, height, sill, style, hinge, swing }.  hinge: 'n'|'s' (axis 'v') / 'e'|'w' (axis 'h');
//   swing: 'e'|'w' (axis 'v') / 'n'|'s' (axis 'h').  Limits: door 60–200 wide, window 40–400, sliding 120–400,
//   passage 60–400; sill + height ≤ ceiling − 20.  To put an opening in another wall: removeOpening + addOpening.
removeOpening(id)                             // gap is filled with wall
flipDoor(id, 'hinge' | 'swing')               // hinged doors only
updateRoom(id, { name, nameHe, type, wet })   // rename / re-type a room (e.g. the 'New room' a new wall created)
resetPlan()                                   // back to the architect's plan (undoable)
```

### What is recomputed after every change (and on load)
* `PLAN.walls` — clean rectangles `{ id, x, y, w, h, kind, cls }`: a straight wall is one rectangle through its
  T-junctions, split only by openings and where `cls` changes. `kind` = `'exterior' | 'mamad' | 'interior'`
  (`thick` / `partition` → `'interior'`). Ids `wNN` are kept where a rectangle is unchanged. **`cls` exists only on
  an edited plan** (the untouched plan keeps the architect's rectangles) — use `wallSegments()` for classes.
* `PLAN.wallOutline` — boundary segments of the wall solids incl. jamb lines (same convention as the architect's).
* `PLAN.rooms` — connected indoor free space; openings separate rooms. Ids / names / type / wet follow the previous
  rooms by largest overlap; a split leaves the id on the larger part and adds `{ id: 'room-<n>', name: 'New room',
  type: <parent's> }`; merged rooms keep the larger one's id. `label` stays if still well inside, else moves to the
  pole of inaccessibility; `zones` go to the room that contains their label; `drawnArea` is dropped once the area
  changed by > 0.3 m². A free-standing wall makes a hole: the polygon then contains a zero-width slit
  (`pointInPolygon`, `polygonArea` and canvas fills work as is).
* `PLAN.openings[i].rooms / exterior / outside` — from the spaces on both sides.
* A plan whose walls, openings and room names equal the architect's again IS the architect's plan
  (`isPlanModified() === false`, exact original arrays).

### Store integration (`src/core/store.js`)
* **Undo / redo / begin–commit–cancel** include the plan: every history snapshot holds `{ walls, openings, rooms }`
  of an edited plan (`null` for the architect's). Restoring emits `'plan' { reason: 'history' }` only if the plan differs.
* `store.serialize().planEdits` = `{ walls, openings, rooms } | null`; `store.load(data)` applies it (a file without
  `planEdits` restores the architect's plan; unreadable or tampered edits — locked parts changed — fall back to it
  without throwing) and emits `'plan' { reason: 'load' }` before `'load'` when the plan changed.
* `store.finishes` of rooms that disappeared are dropped (`'finishes'` is emitted); undo brings them back.
* Engine ↔ store hooks, not for views: `planState()`, `planStateKey()`, `applyPlanState(state)`, `bindPlanHost(host)`,
  `recomputePlan(plan)`.

### Levels — several floors (stage F1, additive; UI behind `FEATURES.levels`, see docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md)
L0 (ground) is the top-level plan, unchanged. Upper levels live in `PLAN.levels` (bottom-up; written only while there is
one, with `schema: 2` — removing the last one gives back the schema-1 plan byte for byte): `{ id: 'L1'…, name?, nameHe?,
elevation, heights: { ceiling, slab, parapet }, walls, wallOutline, openings, rooms, voids?, slants?, stairs?, outdoorAreas? }`.
```js
import { levelPlan, activeLevel, setActiveLevel, addLevel, removeLevel, updateLevel } from './core/plan-edit.js';
import { levelIds, levelOf, levelElevation, levelHeights, levelName, footprintOf, GROUND } from './core/levels.js';  // pure
levelPlan(plan = PLAN, id) → PLAN-shaped view | null  // 'L0' → plan itself. That level's walls, wallOutline, openings, rooms,
                          // slants, stairs, voids, outdoorAreas + the shared meta, site, bounds, assumptions; heights = plan's
                          // merged with the level's; levelId, elevation. SAME object while the level's walls array is the same
                          // (fields refreshed in place, like PLAN). Every `plan`-taking function works on it: wallSegments(view),
                          // spaceAt(x, y, view), wallFaces(view), regulations, renderers. Read-only.
setActiveLevel(id) → { ok, levelId } | { ok: false, reason }   // not undoable, no event; store.setUI({ level }) calls it
activeLevel() → 'L0' | 'L1' …                            // falls back to 'L0' when that level is gone
addLevel({ copyExterior = true, name?, nameHe?, heights? })  // new TOP level 'L<n>'; elevation = below's elevation + its
        // ceiling + the new slab; heights default to the level below's. copyExterior: the envelope of the level below
        // (exterior walls, a safe room's outer walls included) and its windows are copied up — doors are not; rooms derived.
        // ids = [levelId]; level 'permit' (+ REASONS.level) in a fixed plan.
removeLevel(id, { force? })   // the top level, or an empty one (levels above come down). While items / carpentry runs
        // (`level` field), finishes of its rooms or stairs leading to it remain → { ok: false, reason, content: { items,
        // runs, finishes, stairs } } unless force; with force the same `content` comes back and the caller deals with it
        // (e.g. store.begin(); removeLevel(id, { force: true }); store.removeItems(content.items); store.commit()).
        // Finishes of its rooms are dropped by the store ('finishes' event; undo restores them).
updateLevel(id, { name, nameHe, heights: { ceiling, slab, parapet } })   // not L0; refused if an opening would not fit;
        // elevations above are recomputed
```
* **Every § 7 call works on the active level** (`segmentAt`, `canAddWall`, `canAddOpening`, `wallSegments()` without
  argument, `addWall`, `removeWallSegment`, `moveWallSegment`, `resizeWallSegment`, `addOpening`), and the calls by id
  on the level that holds that id (`updateOpening`, `removeOpening`, `flipDoor`, `openingPolicy`, `updateRoom`).
  `resetPlan` resets every level. One undo step covers the whole plan state (`planState()` carries `levels`).
* **L0 is literally the old code path** (an upper level is edited by swapping its arrays and policy into the same engine
  for the duration of the call), so one-level plans, ids, events, files and collab docs are byte-identical.
* **Ids.** Room ids (`room-<n>`) and opening ids (`door-new-<n>` …) are unique across ALL levels (finishes and collab keys
  need no level). L0 wall / segment ids are unchanged; on upper levels they are prefixed: `L1|w03`, `L1|seg:v:…`.
* **Policy.** A level the base plan has is classified against the base plan's level exactly like L0 (exterior walls
  locked in a fixed plan; "outdoors" = outside that level's footprint); a level the base plan does not have is new
  construction (nothing locked). Draft: everything free on every level.
* **`planDiff()`** on a plan with levels: L0's entries as before plus each upper level's, every entry with `levelId`;
  whole-level entries `kind: 'level-added' | 'level-removed' | 'level-changed'` (level `'permit'`, `ref` = level id).
  A one-level plan's entries are unchanged (no `levelId` key).
* **Events.** `'plan'` `changed` gains `levels: bool` (PLAN.levels changed; also for undo / redo / load / remote); an edit on
  an upper level emits `changed: { walls: false, openings: false, rooms: false, levels: true }` and `levelId`. New reasons
  `'add-level' | 'remove-level' | 'update-level'`. `applyPlanState().changed` has `levels` too.
* **Store.** `store.spaceOf(item)` uses `item.level` (absent = L0) via `levelPlan`; finishes clean-up keeps rooms of every
  level; `ui.level` falls back to `'L0'` when the open plan has no such level (another project, undo, a remote removal).
* **Collab.** `addLevel`, `removeLevel`, `updateLevel` are tracked intents (`PLAN_CALLS`); on a plan with levels every
  tracked call is preceded by an intent `setActiveLevel(level)` so a re-run after a conflict edits the same level; the
  re-run restores the person's own active level.
* `meta.floors` is not kept in step by the editing calls (meta is not part of the plan state) — count `levelIds(PLAN)`.
* Tests: `node tests/levels.test.mjs`; the collaboration case is in `tests/collab.test.mjs`.

### Levels in the 2D plan and the UI (stage F2, additive; entry points only while `FEATURES.levels` is on — `?levels=1`)
* **The 2D view shows one level, `store.ui.level`.** Inside `src/view2d/` `env.plan` is a getter = `levelPlan(PLAN, ui.level)`
  (PLAN itself on L0) — never keep it, read it at use. Every layer, snapping, hit-testing, structure tools and overlay,
  measuring, dimensions, room labels, "fit house" and `exportPNG()` (the level shown; `exportPNG({ ghost: true })` adds the
  ghost) work on it. `env.level`, `env.rootPlan` (= PLAN), `env.shown(item)` (not hidden and on the level shown).
* **Items** are drawn, picked, snapped to, box-selected and "select all"-ed only on their level (`item.level`, absent = L0).
  A new item placed in the plan (click, catalogue drop, `actions.place` fallback) gets `level: ui.level` — no key on L0.
  Duplicates keep their level. `src/view2d/levels.js` (pure): `itemLevel`, `isOnLevel`, `itemsOnLevel`, `isShownOn`,
  `levelPatch`, `levelBelow`, `levelAbove`, `ghostOf(plan, id)`, `selectionOnLevel`, `structureSelOn`, `showsGhost`.
* **Site** (street, garden, parking, lot lines, labels) is drawn on L0 only; an upper level keeps a faint dashed lot line.
  **Ghost** (`ui.ghostBelow`, default true): on an upper level the walls / outline / openings of the level below at
  25 %, under the level shown, never pickable, not exported unless asked. Toggle: "Floor below, faintly" in the
  plan-display toggles / menu.
* **Switching** (`store.setUI({ level })`): the view cancels a gesture / placement / measurement / wall being drawn and
  keeps the camera; `src/ui/levels.js` (`app.levels`) drops selections, `structureSel` and `activeSpace` that are not on
  the new level. PageUp / PageDown = floor above / below. `actions.undo / redo` go to the floor an undo changed
  (`historySignature` + `changedLevels`, pure, exported). Junction test: `seg.id.includes('seg:j:')` (ids are prefixed
  on upper levels).
* **UI.** `app.levels`: `current()`, `ids()`, `set(id)`, `step(±1)`, `name(id)`, `menuItems()`, `switcher()` (top bar,
  beside the view switch; in the mode menu on phones ≤ 429 px), `openAdd()`, `openRename(id)`, `openHeights(id)`,
  `remove(id)` (in-app dialog: move the items to the floor below / delete them with the floor / cancel — one undo step),
  `moveItemsTo(ids, id)` / `openMoveMenu(anchor, ids)` (Inspector "Move to floor…"), `statusText()`, `onChange(fn)`.
  `viewPlan(app)` = the level shown. The changes list groups `planDiff()` entries by `levelId`; the Rooms tab lists
  the rooms of the floor shown ("All floors" for every floor).
* **Presence** gains `level` (absent = L0); other people's pointers, selections and soft-lock tags are drawn only on
  the floor they are on.
* Tests: `node tests/levels-2d.test.mjs`, `node tests/e2e.levels.mjs [--shots]`.

### Angled walls: derive (stage A1, additive; creating slants is behind `FEATURES.angledWalls`)
A level (L0 or an upper one) may carry `slants: [{ id: 's01'…, x1, y1, x2, y2, t, kind: 'interior' | 'exterior' |
'mamad', chain? }]` — centre line + thickness, cm (docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 2). A plan that HAS slants is
always derived correctly, whatever the switch; only the entry points that CREATE slants read it (UI, the importer's
default, `buildPlan`'s default).
* **Two paths.** A level without slants (and without openings in slants) runs exactly the grid engine — House 98 and every
  orthogonal plan are byte-identical (ids, rooms, outline, segments; House 98 derive ≈ 1.0 ms before and after). A level
  with ≥ 1 slant runs the **mixed derive** (`plan-edit.js` `deriveMixed`; polygon half in `src/core/slants.js`), per level
  inside the usual level swap:
  - solids = wall rects ∪ rect openings ∪ the slants' joined footprints (`slant-geom` `joinSlants`, recomputed every time
    — a saved `poly` is never trusted, and the engine never writes one) ∪ the gap quads of the openings in slants;
  - rooms / outdoors = the faces of the complement inside the grid frame (bbox + 100 cm): the face touching the frame is
    outdoors, every bounded face a room (openings are solid, so they separate rooms). Room polygons are exact (vertices on
    the kernel's 0.001 cm grid; rounding jogs < 0.0015 cm removed), areas exact; a free-standing wall makes a hole joined
    by a zero-width slit as before. Matching to the previous rooms (ids, names, type, wet, labels, zones, drawnArea; ids
    global across levels) follows the grid engine's rules, by exact overlap area;
  - rect walls keep the grid (cores, classes, jambs, `PLAN.walls` and their ids); free cells under a slant are neither free
    nor bar, so a rect wall ending on a slant has a joined (not free) end; outdoors / sides come from the faces;
  - `wallOutline` = boundary of the wall material (union minus the gaps): diagonal `[x1, y1, x2, y2]` entries appear, each
    written from its west (then north) end, sorted as before; jamb lines included.
* **Slant segments** (one per slant, after the rect segments in `wallSegments()`): `id: 'seg:a:<slantId>'` (upper levels
  `'L1|seg:a:s01'`), `axis: 'a'`, `slantId`, `x1, y1, x2, y2, t`, `angle` (deg of x1→x2, y down), `poly` (joined footprint),
  `x, y, w, h` (its AABB — culling / dirty rects only), `core` (= the AABB; not something to move), `thickness` (= t),
  `length` (centre line), `cls`, `kind`, `policy: { level, reason }` (same table as rects; exterior if a face borders an
  outdoor face anywhere, mamad if the footprint enters the safe-room shell, else thick (t ≥ 15 and on the base plan) /
  partition), `isNew` (< 50 % of its footprint on the base plan's solids), `openingIds`, `between: [l, r]` (spaces on its
  left / right face relative to x1→x2: the most frequent one, sampled every ≤ 20 cm along the free stretches of each
  face), `freeEnds: [start, end]` (no join at that end), `faces: { l: [[a0, a1]…], r }` (stretches, cm from (x1, y1), where
  that face borders open space). Rect segments keep their shape; on a mixed level their `openingIds` never list openings
  in slants, and a `between` side whose middle neighbour is under a slant is taken from the first free neighbour along it.
* **Openings in slants** (`{ id, kind, style, width, height, sill, wall: <slant id>, axis: 'a', at, hinge: 'a' | 'b',
  swing: 'l' | 'r', … }`; `at` = cm from (x1, y1) to the gap centre; 'r' = the right-hand normal (−uy, ux) on screen) get
  derived `cx, cy` (gap centre), `angle` (deg, the slant's), `t`, `x, y, w, h` (AABB of the gap quad — culling only, never
  gap geometry), `rooms` ([indoor side first], as rect openings), `exterior`, `outside: 'l' | 'r'`. Checks (reported in
  `problems` like rect openings: `jamb` / `overlap` / `blocked`): the wall exists; ≥ 10 cm of wall on BOTH faces beside the
  gap (so on the shorter face after mitres; parts of the footprint inside rects / other slants do not count); no overlap
  and ≥ 10 cm between two openings of one slant. Policy as rect openings (exterior → `'permit'`, safe-room shell → `'locked'`).
* **Queries.** `wallSegments(plan)` returns both kinds; `segmentAt(x, y, tol)` = the rect segment containing the point, else
  the slant footprint containing it, else the nearest rect / footprint edge within `tol`.
* **Geometry helpers** (`geometry.js`): `openingFrame(o, plan)` has the `'a'` entry (from the derived `cx, cy, angle, t`;
  without them from `plan.slants`): u = x1→x2, n = right normal, faces `['l', 'r']` (−n, +n), jambs `['a', 'b']` — so
  `openingPoint`, `openingBox`, `openingHinge`, `openingFaceSign / Name`, `openingJambSign` work as for 'h' / 'v';
  `openingPoly(o, plan)` = the gap quad. `slantPolys(plan)` = the joined footprints (the segments' `poly` numbers; cached).
  `wallPolys(plan)` = the rect polys in `plan.walls` order, THEN the slant footprints (id = slant id). `inWall` (footprint
  minus its gaps) and `inWallOrOpening` see slants; `wallFaces(plan)` gets the diagonal faces with true unit normals,
  split at openings. `walkBoxes(plan)` adds each slant as rotated boxes along its centre line, cut at its doors /
  passages, plus one box per window in a slant; `walkBlockers` (axis-aligned) never lists an opening in a slant.
  `levels.footprintOf(level)` counts the slants (recomputed footprints + gap quads).
* **State.** `planState()` carries `slants` (and `schema: 2`) with the other optional keys; `applyPlanState` accepts slants
  and `axis: 'a'` openings (`wall` string, numeric `at`, `width` > 0), derives them, and in a fixed plan refuses a state
  that moves / removes a locked slant (same centre line and thickness required; upper levels too) or changes the built
  footprint (union of walls + openings + rooms, ± 2 cm²). Undo / redo, `isPlanModified`, store files, project files and
  the collab doc carry them unchanged; a plan whose slants are all removed is byte-identical to its schema-1 form again.
  `planDiff()` adds `{ kind: 'slant-added' | 'slant-removed' | 'slant-changed', level, text, at, ref: <segment id> }`
  (removed / changed: the base wall's level, `'locked'` given as `'permit'`); an opening in a slant moved along it reads
  "moved N cm", one in a removed slant is not listed as closed.
* **Existing mutations on a level with slants** (until stage A2): `addWall`, `canAddWall`, `removeWallSegment`,
  `moveWallSegment`, `resizeWallSegment` are refused with `REASONS.angledWalls` (that level only). `addOpening` /
  `canAddOpening` work in rect walls (refused with `REASONS.angledOpening` when the nearest wall is a slant);
  `updateOpening` / `flipDoor` work on openings in rect walls and are refused with `REASONS.angledOpening` for openings in
  slants; `removeOpening` (both kinds), `updateRoom`, `resetPlan`, `addLevel` (an exterior slant and its windows are copied
  up), `removeLevel`, `updateLevel` work. Every successful call re-derives the level with its slants kept.
* **For the next stages:** rely on the segment fields `id, axis, slantId, x1…y2, t, angle, poly, x y w h, length, cls, kind,
  policy, isNew, openingIds, between [l, r], freeEnds, faces`; the opening fields `wall, at, width, hinge 'a'|'b',
  swing 'l'|'r', outside 'l'|'r', cx, cy, angle, t, rooms, exterior` (`x y w h` = AABB only); `openingFrame`,
  `openingPoly`, `slantPolys`, `wallPolys`, `wallFaces`, `walkBoxes`; diagonal `wallOutline` entries; room polygons with
  non-integer vertices. A2 (editing): slots / jambs from `faces`; 'seg:a:' ids are stable by slant id. A3 (2D): draw
  `slantPolys(plan)` (or `seg.poly`), hit-test with `segmentAt`, sides from `between`. A4 (3D): `wallOutline` +
  `slantPolys` + `openingFrame`. A5: regulations / carpentry / walk through `wallPolys`, `wallFaces`, `walkBoxes`,
  `openingFrame` (slant-aware now); `largestInnerRect`, `roomSides` etc. still treat rooms as rectilinear.
* Performance (Node, unloaded): mixed derive of the Wedge ≈ 1.4 ms, House 98 + two slants ≈ 3.3 ms (the first derive
  after adding them, label points recomputed, ≈ 5.4 ms). Tests: `node tests/slants.test.mjs`.

### Regulations, carpentry and the UI per floor (stage F7, additive; one-level plans unchanged byte for byte)
* **Regulations** (`src/regulations/levels.js`, `footprint.js`; `runChecks` branches only when `plan.levels` exists):
  every room / opening / clearance / furniture rule runs on each level's view with that level's items (`item.level`,
  absent = ground; a carpentry unit without one: its run's). Every finding then carries `level`; upper-level ids get
  the suffix `@L1`…; site / whole-house findings carry `scope: 'site' | 'house'`. Ceiling rules use each level's
  heights (L0: `store.project.ceilingHeight` as before); sill guards add the level's elevation to the drop.
  Site rules (setbacks, building line) use `houseFootprint(plan)` = the ground footprint ∪ the upper levels'
  projections (`footprintOf` + polykernel `union`); new rule `built-area` (coverage of the lot, gross floor area per
  floor and in total; pergola exemption and garden area use the coverage). Whole dwelling, once: largest habitable
  room ≥ 12 m², one 70 cm door to a toilet room, the changes summary. Ground-floor only: the routes from the entrance,
  garden, entry path, parking (an upper floor gets an info note `walkway:ground-only:<id>`), assumptions.
  `checkChanges` tags each diff entry with its `levelId` and checks rooms of every level against the base plan's.
* **Carpentry** (`src/carpentry/`): `run.level` (absent = L0). `planOf(run | levelId)` = the level view (PLAN on L0),
  `runLevel(run)`, `itemFloor(item, view)`, `currentLevel()` (the engine's active level = `store.ui.level`),
  `ceilingOf(run)`. `createRun({ …, level })` defaults to the active level; spans, openings, rooms, clearances,
  door swings, `checkRun`, drawings (plan walls), heights all use that level; other floors' items and runs never clash.
  Layout writes `level` on every unit item of an upper-level run (deleted on L0). `moveRunToLevel(runId, levelId)`
  ('move-run', one undo step): wall-bound runs need a wall at the same place, long enough and without a doorway to
  cross, else `{ ok: false, reason: { en, he } }`; islands move freely; links to runs left behind become open ends.
  With levels: drawings get `level` and titles `… · First floor` / `… · קומה א׳`; take-off runs and schedule unit rows
  get `floor { en, he }` + `floorId`; the quotation document names the floor in run titles (TOC, scope table, sheets),
  draws each run on its floor's plan, and the cover shows one key plan per floor with runs.
* **UI**: `FEATURES.levels` can change at runtime — `setFeature(name, on)` / `onFeatureChange(fn)` (core/features.js,
  remembered in localStorage `e7-interior-design/features/v1`; `?levels=1` still wins). The floor controls are built
  once and carry `.levels-only` (hidden unless `html[data-levels]`); turning the feature off shows L0 and keeps the
  data. Settings → Experimental holds the switch. `app.levels.levelOfSpace(id)`, `levelOfItem(it)`,
  `showFloorOf({ level, spaceId, itemIds })`: `focusItems`, `focusSpace` (Look in 3D), `walkTo`, Checks rows and
  carpentry run selection show the right floor first. Every toast "Undo" calls `app.actions.undo()` (floor-following).
  Checks tab and Carpentry runs panel group by floor (`.floorgroup[data-floor]`, `house` = whole house and site).
  `buildShopping(ctx, groupBy, { level })`: rows / groups carry `level`, upper-floor finishes are priced with their own
  ceiling, `total` is always the whole design (`shownTotal` = the filter); the budget tab has a floor filter and the
  CSV a Floor column (plans with levels only). Walk HUD: mini-map and room label follow `'walk-position'.level`.
* Tests: `node tests/levels-rules.test.mjs`, `node tests/e2e.levels.mjs [--shots]`.

### Notes for the view / UI teams
* New opening kind `'opening'` (style `'open'`): draw it as a clear gap with jambs — no leaf, no swing arc; it is
  walkable (`walkBlockers()` only blocks walls and windows).
* Heights are checked against `PLAN.heights.ceiling` (300), not `store.project.ceilingHeight`.
* Tests: `node tests/plan-edit.test.mjs` (also the reference for typical calls).


## 8. Carpentry API (`src/carpentry/`) — core, pure logic (no DOM, no THREE)

Made-to-measure carpentry (kitchen, island, wardrobes, closets, pantry, vanities, laundry, TV wall, shelving, desks) as
editable **runs** of **units**, with validation, a carpenter's take-off, a price-book estimate, shop drawings as vector data
and schedules. Everything runs under plain `node` (tests: `node tests/carpentry.test.mjs`, also the reference for calls).
```js
import * as Carp from './carpentry/index.js';
```
Price data and the carpenter directory are researched separately: `src/carpentry/pricebook.js` (`export default` a price
book, shape below) and `src/carpentry/carpenters.js` (`export default` an array, shape below). The engine never imports them —
the UI passes them in.

### Data model (single source of truth = the store)
* `store.carpentry = { runs: { [runId]: Run }, settings: {} }` — part of undo / redo / `begin…commit`, `serialize().carpentry`
  and `load()` (a file without it → no runs; unreadable → no runs, never throws). Every engine change is ONE undo step and
  emits **`'carpentry' { reason, runIds, transient? }`** (plus the usual `'items'` events for the unit items). `reason`:
  `'create-run' | 'update-run' | 'remove-run' | 'duplicate-run' | 'layout' | 'fit' | 'add-unit' | 'update-unit' |
  'remove-unit' | 'move-unit' | 'move-run' | 'adopt' | 'history' | 'load'`. Views re-render carpentry panels / drawings on `'carpentry'`.
* **Run** `{ id, code, name, nameHe, kind, roomId, anchor: { x, y, dir }, length, levels: string[], freeStanding, spec: RunSpec,
  unitIds: string[], worktops: WorktopPiece[] (derived, refreshed by every layout), ends: { left: End, right: End }, notes, source: 'architect'|'user' }`
  * `kind` ∈ `kitchen | island | wardrobe | pantry | vanity | utility | media | entry | shelving | desk | custom` (`VOCAB.runKind` labels).
  * `code`: `K1 K2…` kitchen, `KI1` island, `WR` wardrobe, `PN` pantry, `VN` vanity, `UT` utility, `MW` media, `EN` entry, `SH`, `DK`, `CU`.
  * **Frame**: `anchor` = the LEFT end of the run's BACK line (wall face) as seen standing in front of it, plan cm; `dir` = the
    units' `rot`. Along = (cos dir, sin dir), front = (−sin dir, cos dir). Run on the north wall: `dir 0`, runs west → east;
    west wall: `dir 270`, runs south → north. Island: anchor = back-left corner of the worktop on the WORKING side; its item
    front (+y local) is the seating side. Helpers: `toPlan(anchor, along, depth)`, `toLocal(anchor, x, y)`, `frame(dir)`.
  * `End` = `{ type: 'wall' | 'open' | 'run', runId?, at?: 'left'|'right' }` — `'run'`: this end butts into another run's front
    (L corner; that run's worktop runs through, this one butts into it).
  * `levels`: which rows the kind uses (`KIND_LEVELS`): `base`, `wall`, `tall`, `full` (wardrobe-type, floor to top box), `island`.
* **Unit** = an ordinary `store.items` entry (so 2D, 3D and walk-through draw it) with `fixture: true, generic: false, price: null`
  and `carp: { runId, module, level, width, at, internals, fronts, spec, handed, note, … }`:
  `width` (cm, the only size the user sets), `at` (cm along the run, written by layout), `level` (resolved), `internals`
  (module specific, e.g. `{ drawers: 3 }`, `{ preset: 'double-hanging' }`, `{ pantry: 'larder' }`, `{ corner: 'lemans' }`,
  `{ shelves: 2 }`, island `{ bays: [{ w, kind: 'drawers'|'doors', drawers }] }`), `fronts` (`{ doors, drawers, hinge: 'L'|'R', mirror }`),
  `spec` (RunSpec overrides for this unit), optional `appliance { label, w, h, d, make, model, itemId }`, `hob: 'gas'|'induction'`,
  `cutout { w, d, fromFront }`, wall row `offset` (absolute along position), `elev`, `h`, `depth`, `cornerSide`, `blind`, `worktop: bool`.
  **Never move / resize a unit item directly** (drag, inspector, `store.updateItem`, `duplicateItems`, `removeItems`): use the
  engine calls below — `layoutRun()` writes `x, y, rot, w, d, h, elev, type, params, name, placement, hidden` from the run.
  A selected unit's run: `Carp.runOfItem(item)`. Units of virtual modules (free wall, appliance space) are `hidden: true`.
* **RunSpec** (`DEFAULT_SPEC` ⊕ `KIND_SPEC[kind]`; units inherit, `carp.spec` overrides; lengths in cm, board / worktop thickness in mm):
  `carcass { material: mfc|plywood|mdf, thickness 18, color, colorHex, back { material: hdf|mfc|plywood, thickness 3 } }`,
  `fronts { material: melamine|laminate|lacquer-matt|lacquer-gloss|veneer|solid-frame|glass|fenix, thickness 18, color, colorHex, style: flat|shaker|j-profile|gola, drawerPattern: equal|graded }`,
  `handles { type: bar|knob|edge-pull|push|none, finish, length (cm) }`, `edge { carcass, fronts: abs-1|abs-2|pvc-0.4|laser|painted }`,
  `plinth { height 10, setback 5, finish: matching-fronts|aluminium|carcass }`, `hardware { grade: standard|soft-close|premium, hinge, drawers, liftUp }`,
  `worktop { material: quartz|porcelain|granite|solid-wood|laminate|stainless|none, thickness 12|20|30|40, color, colorHex, edge: eased|bevel|bullnose|mitred,
  upstand (cm), depth 60, overhangEnd, maxSlab 300, slabDepth; island: overhangSeat 30, waterfall, backPanel }`,
  `splashback { material: same-as-worktop|tiles|glass|none, height 55 }`, `lighting { underWall, inCabinet }`, `appliances [{ label, make, model, niche }]`,
  `heights { worktop 90, wallBottom 145, topLine 220, aboveTop: open|filler|cabinet, body 240 (full-height units incl. plinth), scribe 2 }`,
  `depths { base 56, wall 33, tall 56, full 58, island 56 }` (CARCASS depths; item depth = carcass + front, base units = worktop depth),
  `sliding { doors, mirror }` (sliding wardrobes). All labels: `VOCAB.<group>[key] = { en, he }`, `vocab(group, key)`.
  Free-text values (colours, the default hinge / runner / lift-up descriptions, the UI colour presets) are stored in English;
  their Hebrew is `SPEC_TEXT_HE[lowerCaseEnglish]` and `specText(value)` → `{ en, he }` (unknown text stays as typed in both).
  Take-off hardware variants: `hwVariantLabel(kind, variant)` → `{ en, he }` (handles → `VOCAB.handleType`, handle profiles →
  `VOCAB.frontStyle`, the rest `VOCAB.hwVariant`). Brand names (Blum, Hettich, Caesarstone, Dekton, Fenix) stay in Latin letters.
  Derived heights: `derivedHeights(spec)` → `{ plinth, wt, worktop, baseCarcass, wallBottom, topLine, wallH, tallH, body, … }`.
  Kind defaults: wardrobes / entry / utility `aboveTop: 'cabinet'` (top boxes to the 3.00 m ceiling: unit h = 300 − scribe).

### Module library — `MODULES[id]`, `modulesFor(kind, level)`
Each: `{ id, level, code, name { en, he }, kinds, w { min, max, std }, appliance?, virtual?, carcass, worktop?, cutout?, corner?, internals { default, options, group } }`.
| level | modules (→ 3D `type`) |
| --- | --- |
| base | `base-door` doors + shelf 30–120, `base-drawers` 2/3/4 drawers 30–120, `base-sink` 60–120, `base-hob` 60–120, `base-oven` 60 (appliance), `base-dishwasher` 45–60 (appliance), `base-pullout` 15–40, `base-bin` 30–60, `base-corner-blind` 60–130 (`cornerSide`, `blind`, internals none/shelf/lemans/magic-corner), `base-corner-carousel` 80–100, `base-open` 15–90, `base-space` free-standing appliance space 45–120 (virtual) → `kitchen-base` (`doors, drawers, sink, cooktop, oven, dishwasher, corner, plinth, counter, counterColor, counterThickness, handles, color`); `vanity` 40–180 wall-hung → `vanity`; `media-low` wall-hung 40–120 → `cabinet {legs:'wall'}`; `entry-bench` → `bench {storage}`; `desk` → `desk`; `custom` → `cabinet` |
| wall | `wall-door`, `wall-liftup`, `wall-glass`, `wall-open` 15–120, `wall-hood` 60–90, `wall-microwave` 60, `wall-corner` 60–100 → `kitchen-wall` (`doors, glassDoors, open, handles, color`); `wall-void` free wall (virtual); `media-shelf`, `shelf` → `shelf-wall {variant:'floating'}`; `media-panel` → `cabinet` |
| tall | `tall-pantry` 30–100 (shelves / drawers / larder), `tall-oven` 60, `tall-fridge` 60 (integrated), `tall-utility` 30–70 → `kitchen-tall` (`doors, oven, microwave, fridge`); `tall-fridge-niche` 60–110 (free-standing fridge: the item is the top box above the fridge → `kitchen-wall` at `elev` = fridge h + 5) |
| island | `island` 90–400 (bays auto ≈ 70 cm or `internals.bays`) → `kitchen-island` (`overhang, waterfall, drawers, doors, sink, cooktop, counter…`) |
| full | `wardrobe-hinged` 30–120 (doors 1 ≤ 60 cm < 2), `wardrobe-sliding` 40–120 (run-level sliding doors), `laundry-tower` 65–75, `entry-closet` 30–120, `bookcase` 30–100 → `wardrobe` (`doors, sliding, mirror, handles`) / `bookcase` |
| any | `filler` 2–15 (`carp.level` = row it sits in), `panel` end panel 1.2–8 (its width is its thickness) |
Wardrobe internals presets: `hanging, double-hanging, shelves, drawers, shoes, trousers, mixed`. Appliance modules keep their width in `fitRun`.

### Mutations — `{ ok: true, ids, runIds, warnings, changed, runId?, unitId? }` or `{ ok: false, reason: { en, he } }`
A refused call changes nothing; a call that changes nothing returns `ok: true, changed: false` (no undo step, no event).
Last optional argument everywhere: `{ transient: true }` inside `store.begin() … commit()`.
```js
createRun({ kind, x, y })                     // click a wall: the free stretch around the point (between doors; windows too for tall/full-only kinds)
createRun({ kind, x, y, from, to } | { kind, x, y, length })   // part of the stretch (cm from its left end) — refused across a door for base/tall/full runs
createRun({ kind, anchor: { x, y, dir }, length })             // explicit
createRun({ kind: 'island', x, y, rot, length, depth })        // free-standing, (x, y) = centre
//   + name, nameHe, roomId, spec (deep-merged), ends: { left: 'wall'|'open'|End, right }, levels, notes, units: [{ module, …addUnit opts }]
updateRun(runId, { name, nameHe, notes, roomId, kind, levels, spec /*deep merge*/, length, anchor, ends })
removeRun(runId)  ·  duplicateRun(runId, { anchor } | { x, y } | {})  ·  layoutRun(runId)
addUnit(runId, moduleId, { index | at, width, level, internals, fronts, spec, handed, appliance, hob, cutout, offset, elev, h, depth, note })
//   refused: width outside min / max; the unit would block a door or a tall / full unit would cover a window
updateUnit(unitId, { module, width, level, internals, fronts, spec, handed, appliance, hob, cutout, offset, elev, h, depth, note, worktop, cornerSide, blind })  // null deletes a key
setUnitWidth(unitId, w)  ·  removeUnit(unitId)  ·  moveUnit(unitId, indexInItsRow)
moveRun(runId, { dx, dy, rot })               // free-standing runs (island) only: move dx / dy cm and / or turn `rot` (multiple of 90°,
//   clockwise) about the footprint centre. Refused: wall-bound runs (positioned by their wall), other angles, a footprint that would
//   leave its room or enter a wall / opening / door swing or overlap another run. A drag = transient moveRun()s inside
//   store.begin() … then cancel() and ONE moveRun() of the whole distance (one undo step, a full 'carpentry' event).
//   An island takes along the ordinary floor furniture at its seating side (within 60 cm: the stools), same move / turn.
//   isFreeRun(run) → run.kind === 'island' || run.freeStanding
fitRun(runId, { mode: 'fillers' | 'stretch' | 'units', unitIds, length, toSpan })
//   'fillers' (default): a 5 cm filler (3 cm handle-less) at every end against a wall / another run, adjustable units absorb the rest,
//   then fillers (2–15). 'stretch': no new fillers. 'units': only `unitIds`. `toSpan`: first set the run to the free wall between
//   walls / doors. Never leaves a module's min / max, never changes appliance modules or panels; refused if impossible.
adoptArchitectLayout({ includeMedia })        // generic kitchen / island / tall / wardrobes / hall & entry closets / vanities / utility
//   → runs with the right modules (sink, hob, corner, oven tower, pantries, fridge niche, washer / dryer spaces), positions and
//   footprints preserved, fillers in wardrobe niches, end panels on open kitchen ends, L corners linked. Fridge / washer items stay.
//   Idempotent, one undo step.
```
Layout rules: the floor row (base, tall, full, island, wall-hung base) is laid back to back from `at 0` in `unitIds` order; the
wall row in order from 0, skipping the extent of tall / full units (or from `carp.offset`). Positions: `positions(run, units)`;
codes: `unitCodes(run, units)` → `B1… W1… T1… C1… I1 V1 S1 D1 F1 (fillers) P1 (panels) X1 (spaces)`, left to right per letter;
row extents: `rowExtents(run, units)`. Full geometry of a unit: `geometryOf(run, unit)` → `{ w, h, d, dc, elev, level, zone {y0,y1}, top?, carcassY, fronts, inner, model, spec, H }`.

### Queries
```js
listRuns() · getRun(runId) → { run, units } · runOfItem(item | id)
wallSpanAt(x, y) → { anchor {x,y,dir}, length, a, b, normal, roomId, at, ends {left,right: 'wall'|'open'},
                     openings: [{ id, kind, style, from, to, width, sill, height, top, hinge, swing }] } | null
spanOfRun(run) → span + { runFrom, runTo }     ·  openingConflicts(run, units)
checkRun(runId | 'all') → Finding[]   // { severity: 'error'|'warning'|'info', code, text { en, he }, unitIds, runId }, errors first
runFootprint(run) → { x, y, w, h } | null   // plan box of the run's visible units
runClearances(runId) → [{ side: 'n'|'e'|'s'|'w', d (cm | null = nothing within 4 m), what, whatHe, from [x,y], to [x,y] | null,
                          level: 'ok' (≥ RULES.aisleRecommended) | 'tight' (≥ RULES.aisleMin) | 'short' }]   // walkway around an island
```
Finding codes: `overflow, underfill, width-range, above-ceiling, no-wall, outside-wall, door-crossing, window-base, window-wall,
window-tall, mamad, wall-filler, corner-filler, end-panel, corner-dead, corner-access, hob-tall, hob-wall, hob-window, hob-landing,
wall-over-hob, sink-landing, sink-corner, prep-zone, no-dishwasher, dishwasher-sink, appliance-door, fridge-niche, fridge-landing,
slab-length, joint-cutout, worktop-joints, overhang-support, overhang-knees, end-overhang, wall-low, wall-reach, hanging-depth,
hanging-height, sliding-min, sliding-max, aisle, door-swing, clash` (`aisle` also for islands / free-standing runs: the narrowest
side of `runClearances`, < `RULES.aisleMin` warning, < aisleMin − 15 error, as for wall runs). Re-run checks on `'carpentry'`, `'items'` and `'plan'`.

### Take-off — `takeoff(runId | 'all')`
`{ runs: RunTakeoff[], totals, units: { panels: 'mm', area: 'm2', lengths: 'm' } }`. **Panel sizes in mm**, areas m², lengths m.
* `RunTakeoff = { runId, code, name, nameHe, kind, length, units: UnitTakeoff[], extraFronts (sliding doors), hardware (run level),
  worktops: WorktopPiece[], sliding, plinth { m, height, finish, pieces (3 m stock) }, lighting { underWallM, inCabinetM },
  splashback { m2, material, height, lengthM }, appliances }`
* `UnitTakeoff = { unitId, code, module, name, level, w, h, d, elev, panels: Panel[], fronts: Panel[], hardware: Hw[], appliances, notes }`
* `Panel = { part { en, he }, group: 'carcass'|'back'|'front'|'glass', material, thickness (mm), length, width (mm), qty,
  edges { long, short } (banded edges per piece), edgeType, areaM2, edgeM }` (totals for `qty` pieces).
* `Hw = { kind, label { en, he }, qty, unit: 'unit'|'m', variant?, length? (mm), grade? }`, kinds: `hinge, drawer, liftup, flap-stay,
  handle, push-latch, profile (m), leg, hanger, wall-fixing, shelf-support, rail, rail-support, pullout (variant spice|bin|lemans|
  magic-corner|carousel), larder, trouser-rack, sliding-set, sliding-track (m), appliance-kit, worktop-bracket`.
* `WorktopPiece = { id 'WT1', s, e (cm along the run), length, depth, thickness (mm), material, color, edge, ends { left, right:
  'wall'|'polished'|'joint'|'butt'|'tall'|'waterfall' }, cutouts [{ kind: sink|hob|basin, unitId, x (from the piece's left end), w, d,
  fromFront }], polishedM, upstandM, areaM2, overSlab, jointWarning, waterfall? }`. Pieces ≤ `maxSlab`; joints at unit boundaries
  ≥ 10 cm clear of cut-outs, otherwise moved clear of them.
* Construction rules (cm → mm, t = carcass thickness): base carcass = 2 sides H×D, bottom (W−2t)×D, front + back rail (W−2t)×100,
  back (W−4)×(H−4); wall / tall / full = 2 sides, top + bottom (W−2t)×D, back; top boxes = a second wall-type carcass; shelves
  (inner − 2)×(D−20); carcass edges banded on the front edge, fronts all round; fronts from the front layout with 3 mm gaps (3 mm under
  the worktop); hinges per door 2 / 3 / 4 / 5 for ≤ 900 / 1600 / 2200 / more mm; one drawer system per drawer, runner = longest
  standard ≤ D − 10 mm; legs 4 per carcass (6 over 100 cm); hangers 2 per wall unit. Example (tested): a 60 cm 3-drawer base =
  sides 780×560 ×2, bottom 564×560, rails 564×100 ×2, back 596×776, 3 fronts 597×257, 3 × 550 mm drawers, 3 handles, 4 legs.
* `totals = { materials [{ group, material, thickness, label, areaM2, pieces, edgeM }], edges [{ type, label, m }], fronts { count, areaM2 },
  hardware Hw[], worktops [{ material, thickness, label, areaM2, pieces, polishedM, upstandM, cutouts {sink, hob, basin} }], plinthM, lightingM, splashbackM2 }`.

### Estimate — `estimate(runId | 'all', { tier, pricebook, method: 'market' | 'materials', src })`
Two methods, same result shape. **`'market'` is primary** (default whenever the book has market keys — `hasMarketKeys(pb)`);
`'materials'` (bottom-up from the take-off) is secondary. Price book = `src/carpentry/pricebook.js` (`import PRICEBOOK from
'./carpentry/pricebook.js'`): `{ currency: 'ILS', vat: 0.18, asOf: 'YYYY-MM', priceBasis, tiers: ['basic','mid','premium'],
tierFactor?, rates: { [key]: { unit: 'm'|'m2'|'unit'|'percent'|'job'|'day', low, typical, high, includes, label { en, he },
sources: [{ name, url, date }] (or a single `source`), confidence, tierFactor? } }, notes: [{ en, he }] }` — ILS excluding VAT.

**Tier.** `opts.tier` ∈ `tiers`; without it every run uses `suggestTier(run)`: melamine / laminate fronts → `basic`; lacquer /
Fenix / J-profile → `mid`; veneer / solid wood / glass fronts, gola or premium hardware → `premium` (the UI lets the owner override).
Each run reports `tier` and `suggestedTier`.

**Market mapping** (from the run's real geometry; `rateKeys` on every line):
* Kitchen / pantry / utility runs, along the run: metres with BOTH base and wall units × `kitchen.complete.per-m.<tier>`; base only
  × `kitchen.cabinets.per-m.<tier>`; wall only (incl. the top box over a free-standing fridge) × `kitchen.wall-units.per-m.<tier>`,
  else derived `complete − cabinets` (`derived: true`); tall units × `kitchen.tall-unit.per-unit` scaled by width / 60.
  Free-standing appliance spaces are not counted.
* Island × `kitchen.island.per-m` (else `kitchen.island.per-unit`).
* Add-ons the per-metre rates exclude: corner fittings (LeMans / magic corner / carousel) × `kitchen.corner-fitting.per-unit`, lift-up
  wall units × `kitchen.lift-up-unit[-120].per-unit`, every drawer (fronts + internal) × `kitchen.drawer.per-unit`; pull-outs /
  larders → `noRate` line.
* Worktop pieces × `worktop.<material>.per-m` per running metre (≤ 65 cm deep; deeper pieces and waterfalls pro-rata depth / 60) +
  `worktop.cutout.<sink|hob>[.natural-stone]` (basins use the sink key; granite / local marble use `.natural-stone`).
* Full-height units (wardrobes, closets, laundry / utility cupboards, entry) × m² of front (width × height above the plinth,
  incl. top boxes) × `wardrobe.per-m2.<tier>`; + `wardrobe.sliding.premium-percent` and `wardrobe.mirror-door.premium-percent` on the
  share of sliding / mirror front; internal drawers × `wardrobe.drawer.soft-close`. Bookcases × `bookcase.per-m2`.
* Vanities × `vanity.per-m.<tier>` (mid = mean of basic and premium, `derived`), else `vanity.per-unit`.
* Installation: one `labour.installation.kitchen` job per estimate (on the first kitchen run); wardrobe m² rates include it.
* Lighting: `lighting.led.strip.per-m` × LED metres (strip only).
* Anything else (media, desk, shelving units, custom, pull-outs, a worktop material without a key) → a line with `noRate: true`,
  zero money, a label saying "no published rate — ask the carpenter", and an entry in `missingRates`.

**Materials method** looks up `carcass.<material>` m2 · `back.<material>` m2 · `edge.<type>` m · `plinth.<finish>` m · `fronts.<material>` /
`fronts.glass` / `fronts.mirror` m2 · `worktop.<material>` m2 or m · `worktop.cutout.<kind>` · `worktop.edge` m · `worktop.upstand` m ·
`worktop.waterfall` · `hardware.<Hw kind>` · `internal.pullout.<variant>` / `internal.larder` / `internal.trouser-rack` · `install.<runKind>`
or `install` (percent of the material subtotal, per m, or per unit) · `lighting.led` · `splashback.<material>`; qty × rate × tierFactor.

**Result:** `{ isEstimate: true, method, label { en, he }, disclaimer { en, he }, currency, vat, asOf, tier ('suggested' when per run),
tiers, runs: [{ runId, code, name, nameHe, kind, tier, suggestedTier, components: [{ key, label, basis { en, he }, optional, low, typical,
high, rateKeys, lines: [{ rateKey, rateKeys, label, unit, qty, low, typical, high, sources: [], confidence, includes, note?, derived?,
noRate? }] }], total, totalIncVat, rateKeys, noRateLines }], total, totalIncVat, missingRates: [{ key, label { en, he } }], notes, pricebookMissing }`.
Market component keys: `cabinets, addons, worktop, installation, lighting, other` (`MARKET_COMPONENTS`); materials:
`carcass, fronts, worktop, hardware, internal, installation, lighting, splashback` (`COMPONENTS`). Whole ILS; `total` before VAT;
total = Σ runs = Σ components = Σ lines. **Always present it as an estimate**: show `label` / `disclaimer`, `asOf`, each component's
`basis`, each line's sources / confidence / `includes`, the book's `notes`, and "no published rate — ask the carpenter" for `noRate` lines.

### Bespoke units, door operations, corner pantry, special requirements
Additive to everything above (no field was renamed or removed). New `'carpentry'` event reason: `'feature'`.

**Door / front operation (any unit).** `carp.fronts.operation` ∈ `VOCAB.doorOperation`: `hinged` (default) · `removable` (lift-off
doors, דלתות נשלפות) · `sliding` · `pocket` (retract into side pockets, דלתות כיס נסתרות) · `bifold` (דלת אקורדיון) · `tambour` (roller
shutter, תריס גלילה) · `lift-up` · `drop-down` · `push-open` · `curtain` · `none` (open). A bespoke cell may set its own `operation`.
* Fronts: every door-type `Front` now carries `operation`; `none` turns doors into `open`, `lift-up` / `drop-down` into `flap`
  (hinge `T` / `B`), `push-open` / `curtain` drop the handle, `tambour` / `curtain` merge a row of doors into one front.
* Elevation symbols (ops `role: 'op-symbol'`, `op`): hinged = dashed triangle to the hinge side; removable = up-arrows at both top
  corners + **R**; sliding = double arrow; pocket = arrows into both sides + dashed pocket lines; bifold = dashed fold line + chevron;
  tambour = slat lines; lift-up / drop-down = triangle to the hinge edge; push-open = triangle + **P**; curtain = wavy line. Plan views
  mark non-hinged corner faces with the key letter. Every plan / elevation / internal drawing has **`legend: [{ op, key, label { en, he } }]`**
  for the operations it shows, also drawn as text ops `role: 'legend'` (with `op`) under the drawing; keys in `OP_KEY`
  (`◁ R ↔ ⇤⇥ Λ ≡ △ ▽ P ∿ ○`).
* Take-off `Hw` instead of hinges: `lift-off-hinge` (removable, qty = hinges for the door height), `sliding-set` + `sliding-track` (m),
  `pocket-system`, `bifold-set`, `tambour-kit` (per door / shutter), `curtain-track` (m), `push-latch` (+ hinges for push-open);
  `specifiedByCarpenter: true` on removable / pocket / bifold / tambour / curtain fittings (the exact product is the maker's choice) —
  also on the schedules' hardware rows. Mapping: `OPERATION_HARDWARE`, `BY_CARPENTER`.
* Schedules: unit rows get `operation { en, he }` (and `fronts` mentions it when not hinged). 3D: `none` → model `open: true`;
  sliding / pocket on wardrobes → `sliding: true`; otherwise the same model with doors.
* Estimate (market): sliding doors × `hardware.sliding-gear.per-door`; other special operations → `fittings.<op>` lines with `noRate`.

**Corner modules that occupy both arms.**
* `tall-corner-pantry` (level tall; kinds kitchen / pantry / utility): `width` = **legA** (along its own run, 70–160),
  `carp.legB` (along the other arm, measured from this run's wall, default 90), `carp.cornerSide: 'L'|'R'` (the end it sits at),
  `internals.cornerPantry` ∈ `VOCAB.cornerPantry`: `l-doors` (two doors meeting at the inside corner, no post; faces A and B),
  `diagonal` (angled front, 1–2 doors), `walk-in` (larger legs ≥ 120, one door on the angled face, U shelving); `internals.shelves` (5);
  any `fronts.operation`. Put it FIRST / LAST in the run that goes through the corner (the run the other arm butts into, or at a wall corner).
* `base-corner-diagonal` (80–100, legs = width, worktop over it) and `wall-corner-diagonal` (55–75; draws / takes off its diagonal
  shape but does not reserve the other arm's wall row). `base-corner-carousel` now also reserves its leg on the other arm.
* **Reservation**: corner modules with a leg on the other arm write, on the other run, the derived
  `run.reserved = { left, right (cm), by: { left|right: { cm, level, runId, unitId } } }` (absent when nothing is reserved). The floor row of
  that run starts after `reserved.left` and must end at `length − reserved.right` (`checkRun` overflow / underfill, `fitRun` target and
  `positions()` use it); its worktop stops against a TALL corner unit (end `'tall'`) and runs over a BASE corner unit (to the butt joint).
* Geometry (`geometryOf`): `corner = { variant, side, legA, legB, dA, dB, poly: [[u, v]…], faces: [{ id: 'A'|'B'|'diag', a, b, len }] }` in
  corner-local cm (u along this run from the corner, v from this run's wall), `trueFronts` (true-size doors per face, `face`), and the
  elevation `fronts` as seen from this run (the other arm's end panel + the projected face). The store item is the bounding box
  legA × legB (3D shows a box). Drawings: plan = true footprint (`poly` op with `corner: true`, role `unit`), faces (role `front`, `face`),
  swings or operation key, shaped shelves dotted; the other arm's plan / elevation show a `role: 'reserved'` zone labelled with the unit
  ref (e.g. `K1·T1`) and the B-face doors; internal elevation shows shelf heights.
* Take-off: `Side (end of this arm)`, `Side (end of the other arm)`, shaped `Top` / `Bottom` / `Corner shelf` panels with
  `shape: 'L'|'diagonal'` and `outline: [[x, y]…]` (mm, corner-local; `length` × `width` = bounding box, `areaM2` = true area), two backs,
  `Angled front frame rail` ×2 (diagonal / walk-in), the other arm's end panel (front material), true-size doors, legs 6, wall fixings 3.
* Checks: `corner-placement`, `corner-owner`, `corner-pantry-doors` (hinged L-doors clash at the inside corner), `corner-pantry-access`
  (face < 30 cm, diagonal < 45 cm, walk-in legs < 120 cm), `corner-overlap` (error). Corner units are fixed in `fitRun`.
* Estimate (market): the pantry is priced as tall units × (legA + legB − depth) / 60.

**Bespoke unit composer.** `custom` is now a free-form unit on ANY level (`carp.level`) in any run kind:
`carp.width`, `carp.h` (total height incl. plinth / worktop), `carp.elev`, `carp.depth` (carcass depth), `carp.worktop: true` (base),
`carp.noPlinth`, and `carp.internals.layout = { columns: [{ w | flex, cells: [{ h | flex, kind, operation?, count?, hinge?, shelves?,
label?: { en, he } | string, note? }] }] }` — columns left → right, cells **bottom → top**; `w` / `h` fixed cm or `flex` (number weight or
`true`) to share the rest of the front area (width × front-zone height). Cell `kind` ∈ `VOCAB.cellKind`: `door`, `drawer`, `drawers`
(`count`), `open` (`shelves`), `glass`, `panel` (fixed front), `appliance` (`label`), `pullout`, `void` (empty niche).
* Fronts carry `cellId` (`'<column>.<cell>'`, 1-based); inner = dividers between columns, fixed shelves between cells (not between
  drawer cells), cell shelves, pull-outs. `layoutGrid(layout, w, y0, y1)` → `[{ x0, x1, cells: [{ id, ya, yb, cell }] }]`.
* `validateCustomLayout(layout, w, h)` → `[{ en, he }]` (sums, min column 10, min cell 8 / door 20, drawers ≥ 10 each, known kinds and
  operations); `addUnit` / `updateUnit` refuse an invalid layout with the first reason (`reasons` = all); `checkRun` → `custom-layout`
  errors and a `bespoke` info finding on every custom unit.
* Drawings: elevation draws every cell's fronts with their operation symbols; the internal elevation draws one `role: 'cell'` rect per
  cell (`cellId`, `unitId`) with its label, a `cols-<code>` width chain (sums to the width) and `cells-<code>-<n>` height chains per column
  (sum to the front height). Take-off: carcass (base type for base / island, otherwise top + bottom), dividers, fixed and cell shelves,
  a front per cell front (`Fixed front panel` for panels), hardware per cell kind and operation. 3D: kitchen-base / -wall / -tall /
  wardrobe with the door / drawer counts. Codes follow the level (B, W, T, C, I).
* `customLayoutTemplate(name)` → ready `addUnit` options (`{ module: 'custom', level, width, h, depth?, elev?, worktop?, internals: { layout },
  label }`) for `appliance-garage` (tambour), `open-shelves-drawers`, `tall-larder-drawers`, `window-seat`, `bar-niche` (`CUSTOM_TEMPLATES`):
  `addUnit(runId, 'custom', customLayoutTemplate('bar-niche'))`.
* `toCustom(unitId)` converts any unit to `custom` keeping its look (same fronts, size, elevation, depth, worktop, operation);
  `carp.convertedFrom` = the old module. `frontsToLayout(geometry)` is the converter.

**Special requirements (`Feature`).** The owner's free text — never translate it.
`Feature = { id, n, title, text, category: 'construction'|'doors'|'internal'|'finish'|'hardware'|'appliance'|'lighting'|'electrical'|'other',
priority?: 'must'|'nice', images?: [{ id, name, w, h, dataUrl? , stored? }] }` on `run.features` or `unit.carp.features`; `n` is a stable
number per run (`run.featureSeq`), shown as ①②… (`circled(n)`). Images with a data URL over 50 000 characters are kept out of the undo
history in `store.carpentryImages[imageId]` (saved by `serialize()` / restored by `load()`); the feature keeps `{ id, name, w, h, stored: true }`
and `featureImage(imageId)` returns the data URL.
```js
addFeature({ runId } | { unitId }, { title, text, category, priority, images })  // → { ok, featureId, n }
updateFeature(featureId, patch)  ·  removeFeature(featureId)  ·  featureImage(imageId)
listFeatures(runId | 'all', src?) // → [{ …feature, runId, run, unitId, code, ref ('K1·T1' | 'K1'), label ('①') }]
```
* Drawings: plan and elevation get a numbered balloon per feature — ops `role: 'callout'`, `featureId`: a leader line, two half-circle
  arcs and a text op (`text: '1'`, `label: '①'`) — on the unit (top in elevation, front in plan) or, for run features, at the run's left.
* `schedules().features` rows `{ runId, unitId, featureId, n, label, ref, code, title, text, category { en, he }, priority { en, he }, images }`
  (`headers.features`); every `must` feature adds a question "Please confirm how you would build ① K1·T1 "title": text"
  (`featureId` on the row); every bespoke unit adds a construction question.
* Estimate (both methods): a component `special` with one line per feature `{ rateKey: 'feature:<id>', noRate: true, low/typical/high 0,
  featureId, label 'Special requirement ① … — priced by the carpenter' }`, also listed in `missingRates`.
* `checkRun`: an info finding `feature` per requirement ("no automatic rule checks — the carpenter confirms it").

### 3D (additive) — `src/models/carpentry.js`, `src/view3d/carpentry.js`
* **Model type `carpentry-unit`** (`types.js`, file `carpentry`). `registry.buildModel` / `drawSymbol` route EVERY item with `carp`
  to it; the item keeps its generic `type` / `params` (the table above is unchanged, saved designs load as before). The model reads
  the unit's run from the bound store and builds from `geometryOf()` (carcass heights / depths, `fronts` with their `operation`,
  `inner`, `corner` + `trueFronts`) and `run.worktops` (each worktop-carrying unit draws its slice; the first / last unit of a piece
  also draws the overhangs / waterfall ends; sink / hob / basin cut-outs with bowl, tap, hob glass). Corner modules
  (`tall-corner-pantry`, diagonal base / wall corners) are drawn with their true L / diagonal shape on both arms — the 2D plan
  symbol too; everything else keeps the generic 2D symbol. Without a run it falls back to the generic model of `item.type`.
  Def extra: `getModel('carpentry-unit').footprint(item)` → `{ poly, rects }` (item-local cm) for corner units, else null —
  walk mode collides with the two arms, not the open floor inside the L.
* View-only build state `item.view = { open: true }` (never stored): doors swing ~95° (pocket: pushed in; bifold: folded;
  lift-off: set aside), drawers pulled ~30 cm, flaps up / down, sliding doors slid, tambours rolled up, curtains gathered.
* `view3d.showCarpentry({ runId | null, open, cut, frame, animate })` → state: frames the run from its front (island: working
  side), a vertical section plane removes everything between the camera and the run (+ items standing in that corridor are
  hidden in the view only; picking ignores what is cut; walk mode never cuts), open fronts for that run, units flagged by
  `checkRun` (errors / warnings) outlined + pinned with the Checks text. The carpentry selection gets the selection outline.
  Unit models rebuild when their `carp` or their run's spec / worktops / reservations change (items-layer `setVariant`).
* `showCarpentry({ studio })`: **studio light** while a run is shown (not in walk mode) — for that render only: two neutral-white
  shadowless directional lights following the camera, the sun eased (×0.35), exposure 1 and `NeutralToneMapping`; everything is
  restored right after `renderer.render()` (`carpentry.beginFrame(camera, { env })` → undo), so the normal daylight / eye adaptation
  is untouched outside it. The two lights stay in the scene at intensity 0 after first use (no shader recompiles per toggle).
* Model details: run `spec.splashback` (material, height) on each worktop-carrying unit's slice exactly as the elevation draws it
  (stopped under wall units, cut at windows; tiles show metro joints; not on islands) and `spec.worktop.upstand` (cm) as a worktop
  strip; lift-off (`removable`) doors show a 6 mm shadow gap with a dark rebate and 2–4 exposed lift-off hinges while closed;
  sliding wardrobe doors follow the elevation's door split (`spec.sliding.doors` or max(2, ⌈len / 100⌉), 3 cm overlap,
  alternate tracks), each carcass drawing its share of every door.
* UI: Carpentry workbench tab **3D** (switches Plan → Split while open, back on leaving): "Open fronts", "Studio light" (default on),
  "Cut away the room in front", "Frame the run", and the run's fit problems (click → selects the unit). Phone (≤ 699 px): the tab is
  a bottom sheet under a full-width 3D view (key plan hidden); closing the sheet leaves the tab state.
* Test: `node tests/carpentry-3d.test.mjs` (bounds, every module closed / open, corner pantry on both arms, worktop cut-outs,
  splashback vs elevation, upstand, lift-off details, sliding door split, studio light set / restore).

### Drawings — `drawings(runId)` → `Drawing[]` (plan, elevation, section, worktop if any, internal if tall / full units)
`Drawing = { id, kind: 'plan'|'elevation'|'section'|'worktop'|'internal', runId, title { en, he }, scale (1:scale, from 10/20/25/50/100 to
fit A3 landscape), bounds { x, y, w, h } (real cm incl. dimensions), yUp: true, ops: Op[], dims: DimChain[] }`.
* Coordinates: **real cm, y UP in every drawing** (flip once). `lw` = line weight and `size` = text height, both **paper mm**
  (`LW = { heavy .5, medium .35, thin .18, hair .13 }`, `TEXT = { code 3, label 2.2, dim 2, small 1.8 }`); paper mm = cm × 10 / scale.
* `Op`: `{ t:'line', x1,y1,x2,y2, lw, dash? }` · `{ t:'rect', x,y,w,h, lw, fill?, hatch? }` · `{ t:'poly', pts, close, lw, fill?, dash? }` ·
  `{ t:'arc', cx,cy,r, a0,a1 (deg CCW from +x, drawn CCW a0→a1), lw, dash? }` · `{ t:'text', x,y, text: string | { en, he }, size, anchor:
  'start'|'middle'|'end', rot? (deg CCW), weight? }` — text `(x, y)` is the anchor point at the text's VERTICAL CENTRE. `dash` ∈
  `dash | dot | center`. `fill` / `hatch` are semantic: `wall, plinth, worktop, appliance, glass, blind, splashback, void, section` (`FILL`).
  Ops carry `role` (`dim, dim-text, code, label, wall, opening, unit, front, plinth, worktop, cutout, joint, edge-polished, swing,
  splashback, internal, context, note, floor, ceiling`) and `unitId` (unit outlines / codes) for styling and hit-testing.
* Frames: **elevation / internal**: x along the run (0 = left end seen from the front), y up from the floor (ceiling line at 300); island
  elevations are seen from the working side (mirrored). **plan**: x along, y = −depth (wall at the top, room below). **worktop**: same as
  plan. **section**: x = distance from the wall face (island: from the working edge), y up.
* Content: plan — walls (cut, `fill:'wall'`), windows, doors with swing arcs, units (floor solid, wall dashed), fronts' door swings,
  worktop outline + cut-outs, neighbouring carpentry dashed; elevation — floor, ceiling, side walls, windows / doors behind (dashed +
  `W 180/100(+110)`), plinth, carcasses, every front (door / flap opening symbols, handles, drawer lines, glass, appliances outlined and
  labelled), worktop, splashback (cut at windows), bulkhead filler / top boxes, sliding doors, unit codes; internal — carcass,
  shelves, rails, drawers, pull-outs with per-unit height chains; worktop — pieces (`WT1…`), joints (dash-dot + JOINT), L-corner joint,
  cut-outs with position / size chains, polished edges heavy; section — wall, plinth + setback, carcass, front, worktop + overhang,
  splashback, wall unit, top box, hanging rail.
* `DimChain = { id, axis: 'x'|'y', pts, values, total, at, lanes }` mirrors the drawn chains (`units`, `overall`, `wall-units`,
  `heights`, `ceiling`, `depth*`, `cutouts`, `pieces`, `inner-<code>`…). Unit chains sum to the run length. Texts that do not fit their
  segment are moved to an outer lane with a leader, so **no two dimension texts overlap**; `textBox(op, scale)` gives the real-cm box
  used for that test (`textWidthMm` ≈ 0.6 em per character) — keep the renderer's font metrics close to it.

### Schedules — `schedules(runId | 'all')`
`{ headers, units, materials, hardware, worktops, appliances, questions, totals }`; `headers[table] = [[key, { en, he }]…]` gives column
order and titles. Rows (all text bilingual): `units { ref 'K1·B3', run, code, unitId, module, level, size { w,h,d }, sizeText, elev, fronts,
internals, hardware, notes }` · `materials { run, element, material, thickness, colour, finish }` · `hardware { item, spec, qty, unit, kind }`
· `worktops { ref, material, thickness, size, sizeText, cutouts, edges, area, waterfall }` · `appliances { ref, appliance, make, niche }` ·
`questions { run, topic, text }` (auto-generated: site measurements, ceiling / floor checks, appliance models, cut-out templates, services,
hardware choice, corner, wardrobe interiors, mamad fixing, tolerances). Codes match the drawings.

### Carpenters — `sortCarpentersByDistance(list, { latitude, longitude } = house)`
`list` items `{ id, name, nameHe?, city, region, lat, lon, specialties: [], website, phone?, email?, address?, source { url, checkedAt }, notes? }`
→ new array with `distanceKm` (haversine, 1 decimal; `null` without coordinates), nearest first, no-coordinate entries last.
`haversineKm(lat1, lon1, lat2, lon2)`.

### Notes for the UI / PDF teams
* Use `checkRun` severities: errors block "send to carpenter", warnings are shown, info is advice.
* The estimate is not a quotation; show the price book's `asOf` and sources. Fridge / washer / dryer stay ordinary catalogue items.
* Plan view hook (Carpentry mode): `view2d.setCarpentryDrag({ canDrag(itemId), start({ itemId, x, y }), move({ itemId, x, y, dx, dy, snap }),
  end({ itemId }), cancel() })` — a press-drag on a unit it accepts goes to the handler instead of panning (the UI accepts island
  units only: drag = move, 5 cm grid; arrows nudge 5 cm, Shift 1 cm; R / Shift+R and the Run tab's "Turn 90°" turn it).
* Store hook used by the engine only: `store._applyCarpentry(change, opts)`. `Carp.bindStore(otherStore)` for workers / tests;
  read-only functions also take a `src = { carpentry, items }` (e.g. a parsed design file): `checkRun / takeoff / drawings / schedules (runId, src)`, `estimate(runId, { …, src })`, `listRuns(src)`, `getRun(runId, src)`.

## 9. Quotation document API (`src/carpentry/doc/`) — request for quotation to carpenters (pure layout + renderers)

The owner exports a tender package (PDF) to hand to carpenters, in **English or Hebrew** (chosen at export, never
mixed). Layout is done ONCE (`composeQuotation` → `Doc` of page primitives); the SVG preview and the PDF renderer are
dumb and draw identical pages. Runs in the browser (offline, sandboxed iframe) and under plain node.
Libraries: `vendor/pdf/pdf-lib.esm.min.js` (pdf-lib 1.17.1, MIT) and `vendor/pdf/fontkit.esm.js` (@pdf-lib/fontkit 1.1.1,
MIT, UMD build wrapped as ESM); font: Heebo 300/400/500/700 TTF (`vendor/fonts/Heebo_*.ttf`, OFL, `LICENSE-Heebo.txt`)
for both languages. Test: `node tests/carpentry-doc.test.mjs` (writes `dist/carpentry/*.pdf`). Preview page: `dev/carpentry-doc.html`.
```js
import { buildQuotationPDF, buildQuotationPreview, drawingToSVG } from './carpentry/doc/index.js';
const opts = {
  lang: 'en' | 'he',
  runIds: 'all' | [runId…],                 // default 'all' (Carp.listRuns order)
  paper: 'A4' | 'A3',                       // drawing sheets (landscape); text pages are always A4 portrait. Default A4
  include: { estimate: false, cutLists: true, carpenterForm: true, questions: true },   // estimate:true = "owner's copy"
  project: { title, address, ownerName?, phone?, email?, date: 'YYYY-MM-DD', reference },  // empty fields are omitted
  src: { store, plan: PLAN },               // the app store + PLAN (read-only; defaults: bound store, core PLAN)
  pricebook?, tier?, method?,               // only for the owner's-copy estimate page (Carp.estimate; default method 'market',
                                            // tier per run as suggested by the engine — pass tier: 'mid' for one tier)
};
const { doc, svgPages } = buildQuotationPreview(opts);          // sync; svgPages[i] = '<svg …>' for page i (mm size)
const { bytes, filename, pages } = await buildQuotationPDF(opts); // Uint8Array, 'House98-Carpentry-RFQ-2026-11-13-HE.pdf'
el.innerHTML = drawingToSVG(Carp.drawings(runId)[1], { lang, interactive: true });  // one shop drawing for the editor
```
* **Download** in the UI: `new Blob([bytes], { type: 'application/pdf' })` → object URL → `<a download={filename}>`.
  The first PDF build fetches the four TTFs relative to the module (`vendor/fonts/`, ≈ 225 KB, cached); pass
  `fonts: { light, regular, medium, bold }` (Uint8Array) or `fontBase` (URL) to override. A full 13-run document
  (≈ 88 pages, ≈ 600 KB) composes in ≈ 0.4 s and renders to PDF in ≈ 1 s. Run it on a click, not on every store event.
* **Preview**: insert `svgPages` (each SVG has `width/height` in mm and a `viewBox` in mm; set `width:100%; height:auto`
  to scale). Fonts come from `@font-face` rules inside each SVG pointing at the same TTF files (the dev server should
  serve `.ttf` as `font/ttf`; browsers accept octet-stream too). Re-compose on `'carpentry'`, `'items'`, `'plan'`.
* **Before export**: `Carp.checkRun('all')` errors should block "send to carpenter" (the document itself lists only
  warnings / info as "design notes"); `doc.meta.errors` repeats the error count.

`drawingToSVG(drawing, { lang, width?, height?, padding = 4, className?, interactive = true, print = false, scale?, fonts = true })`
→ SVG string. y flipped, paper-mm line weights / text sizes at the drawing's scale (or `scale`), semantic fills / hatches
mapped to print-style fills, `text.en` / `text.he` picked, Hebrew as logical text with `direction: rtl` (anchors kept
physical). `interactive`: every op has `class="op op-<role>"`, unit outlines / codes carry `data-unit-id` (click → select
the unit). Theme: `currentColor` + CSS variables `--carp-ink, --carp-ink2, --carp-muted, --carp-rule, --carp-hair,
--carp-accent, --carp-accent-tint, --carp-fill-wall | -plinth | -worktop | -appliance | -glass | -splash | -void | -section |
-blind, --carp-hatch` (fallbacks work in light and dark); `print: true` = black on white with a white background.

### Doc model (`composeQuotation(opts) → Doc`)
`Doc = { lang, dir: 'ltr'|'rtl', pages: Page[], meta }`; `Page = { size: [wMm, hMm], orientation: 'portrait'|'landscape',
kind: 'text'|'sheet', role?: 'cover', runId?, sheetCode?, ops: PageOp[] }`. Page mm, origin top-left, **y down**; colours are
palette tokens (`ink ink2 grey rule hair tint paper accent accentTint accentMid fWall fPlinth fWorktop fAppliance fGlass
fSplash fVoid fSection fBlind hatch`, `PALETTE` in `prims.js`) or `#rrggbb`. PageOps (closed set):
`line {x1,y1,x2,y2,lw,color,dash?}` · `rect {x,y,w,h,fill?,lw?,color?,dash?}` · `poly {pts,close,fill?,lw?,color?,dash?}` ·
`arc {cx,cy,r,a0,a1 (deg CCW as seen),lw,color,dash?}` · `text {x,y (baseline anchor),text (logical),vis (left-to-right
drawing order),size (pt),font: light|regular|medium|bold,color,align: left|center|right (physical),w (mm, real metrics),dir,rot?,maxWidth?}` ·
`image {x,y,w,h,src (PNG / JPEG data URL)}`. A `text` whose string holds glyphs Heebo lacks (door-operation keys
`◁ ↔ ⇤ ⇥ Λ ≡ △ ▽ ∿ ○`, circled numbers ①–⑳) carries `parts: PageOp[]` — plain text segments + small vector symbols at the
exact advance positions; renderers draw `parts` instead of the text (no missing-glyph boxes, font-independent) · `drawing {id,kind,runId,scale,box,ops}` (a shop drawing already flattened
to page mm). `dash` ∈ `dash | dot | center` (`DASH`, mm). Ops may carry `role` / `unitId`.
`meta = { title, project, reference, paper, lang, filename, runs: [{ id, code, page }], sections: [{ num, title, page, level }],
tables: [{ id, rows, drawn }], include, errors, warnings, composeMs }`.

### The document (both editions paginate identically: every row reserves the height of the taller language)
Cover (title, project block with the filled-in fields only, key plan of the house from `plan.walls` with every run's unit
footprints highlighted and coded, north arrow; owner's-copy banner when the estimate is included) · Contents (page numbers)
and the invitation to tender · 1 Scope of works (runs table) · **Special requirements** (consolidated, only when there are
features) · General specification (most common value per item, per-run exceptions listed by code) · Included / excluded ·
Per run: landscape drawing sheets (frame, view captions with number + title + scale, north arrow on plans, title block:
mini key plan, project, run / room / kind / length, drawings + scales, reference, date, paper, sheet code `K1-01`,
page n / N, dimension note), views packed at the finest standard scale ≥ the engine's (1:10/20/25/50/100) that fits the
paper, plan + elevations stacked on a common x = 0 when they share a sheet, internal / bespoke views on their own sheet;
then the run's special requirements (numbered as the drawing callouts, owner's text + reference images), unit schedule
(columns = `HEADERS.units`, so new engine columns such as door operation appear automatically), materials & finishes,
hardware, worktop schedule, design notes (checkRun warnings / info) · Appliance schedule · Cutting lists (indicative; grouped
by material, edge-banding marks) · Questions for the carpenter (with a reply column) · Quotation form (price breakdown per
run: carcasses, fronts, worktop, hardware & fittings, lighting, installation, run total — n/a cells shaded; a line per
special requirement; subtotal, site measurement & shop drawings, delivery, total excl. VAT, VAT 18 %, total incl. VAT;
alternatives; lead time, installation days, measurement date, payment terms, warranty, validity, deviations; bidder details;
name / signature / date / stamp) · Owner's estimate (only with `include.estimate`: ranges per run, totals excl. / incl. VAT,
basis, `asOf`, missing rates, sources, the estimate disclaimer). Text pages carry a header (project · title, reference · date)
and a footer (dimension note, page n / N). Furniture strings: `src/carpentry/doc/strings.js` (`S`, `INCLUDED`, `EXCLUDED`, `ALTERNATIVES`).

### Hebrew / bidi
`visualOrder(line, 'ltr'|'rtl')` implements UAX #9 for one line (W1–W7, N0 bracket pairs, N1–N2, I1–I2, L1, L2, L4 mirroring;
verified against Chromium) and is applied AFTER line wrapping; `autoDir(text, fallback)` picks a paragraph's direction from its
first strong character (owner's free text keeps its own direction in either edition — never translated). pdf-lib draws `vis`
glyph by glyph (fontkit's own RTL reversal is disabled on the embedded font); the SVG preview draws the same `vis` with
`unicode-bidi: bidi-override`, so both are identical. RTL documents mirror every region (tables: first column on the right,
furniture and title blocks mirrored); drawings themselves are never mirrored. Text widths come from the real Heebo
advances (`metrics-data.js`, generated from the TTFs and re-checked by the test); no kerning / ligatures in either renderer.
Spec values in the Hebrew edition are always the Hebrew side of the engine vocabulary (`VOCAB`, `specText` for colours and
hardware descriptions, `hwVariantLabel` in the hardware schedule); schedule `materials.colour` is `{ en, he }`.

### Special requirements, bespoke units, door operations (engine § 8 "Bespoke units…")
* Features come from `schedules().features` (`{ runId, unitId, featureId, n, label '①', ref, code, title, text, category { en, he },
  priority { en, he } }`) with images from `listFeatures()` (`stored: true` images fetched with `featureImage(id)`; PNG / JPEG are
  embedded). The owner's `title` / `text` are printed exactly as typed (own paragraph direction via `autoDir`); category / priority
  in the edition's language. They appear in a consolidated "Special requirements / דרישות מיוחדות" section after the scope, as a
  numbered block (number = the drawing callout) at the top of the run's schedules (with images), and as one priced line each in
  the quotation form. Must-features also reach the questions table through the engine.
* Drawing roles: `callout` (accent, bold digit, knock-out behind it), `op-symbol` / `legend` / `cell` (dark grey), `reserved`
  (grey); `code` texts get a paper-white knock-out box so unit codes read over door symbols. The legend is printed ONCE, on the
  view caption line from `drawing.legend` (`key label`, keys drawn as vector symbols); the engine's `role: 'legend'` text ops are
  dropped from the sheet and the view's bounds recomputed (keeps 1:25 on A4). Internal views (incl. bespoke `cell` layouts) get
  their own sheet.
* Unit schedule columns = `HEADERS.units`, plus "Door operation / אופן פתיחה" when a run has non-hinged units; corner-pantry
  legs (`corner`) are added to the notes.
* Owner's estimate: per-run low / typical / high and totals excl. / incl. VAT, basis (method, tier, `asOf`, VAT), each
  component's `basis`, every `missingRates` / `noRate` line under "Priced by the carpenter (not in the estimate)", and sources.

## 10. Projects and plan source (`src/core/projects.js`, `src/core/plan-build.js`, `src/core/plan-edit.js`) — core

The app holds **several projects**, each with its own base plan (house + site + location), plan phase and design.
House 98 (`plan.js`) is the **built-in** base plan and the default; it behaves exactly as before.

### Switchable base plan (`plan-edit.js`)
`PLAN` stays ONE object; opening a project replaces EVERY field of it. Read `PLAN.*` (or `ctx.plan.*`) at the time of
use — never keep `PLAN.meta` / `PLAN.site` / `PLAN.bounds` / arrays across a `'base'` event.
```js
import { BASE_PLAN, BUILTIN_PLAN, PLAN_KEYS, setBasePlan, isBuiltinBase, planPhase, setPlanPhase,
         currentPlanData, analyseWalls, wallBounds } from './core/plan-edit.js';
BASE_PLAN               // live binding (`export let`): deep-frozen base plan of the open project (House 98 = BUILTIN_PLAN)
BUILTIN_PLAN            // House 98, deep-frozen, never changes
setBasePlan(planData, { phase: 'draft' | 'fixed' })   // engine only — UI / projects use store.openProject()
isBuiltinBase() → bool  // the base plan is House 98: the architect's layout / carpentry / "architect's plan" wording exist only then
planPhase() → 'draft' | 'fixed'
setPlanPhase(phase)     // engine only — use store.setPlanPhase()
currentPlanData()       // plain copy of the live plan as a complete PLAN-shaped object
analyseWalls(walls, openings, { prevRooms, outdoorAreas, level?, reservedRoomIds? }) → { walls, openings, rooms, wallOutline, problems, segments }  // pure
        // level 'L1'…: ids for that upper level ('L1|w01', 'L1|seg:…'); reservedRoomIds: room ids new rooms must avoid
wallBounds(walls, openings?) → { x, y, w, h } | null
```
**Phases.** `'fixed'` = the base plan is the house as built: § 7 applies unchanged (four permission levels, changes list
against `BASE_PLAN`). `'draft'` = the owner is still drawing the existing house: every wall and opening is `'free'`, walls
may be drawn anywhere on the lot (7–30 cm thick; a wall drawn from / to another wall's centre line makes a clean corner),
no permit warnings, `isPlanModified()` is false and `planDiff()` is empty, `PLAN.bounds` follows the walls. Rooms are
always re-derived from the walls (§ 7 "What is recomputed"; matched to the previous rooms by exact overlap, so names,
types and finishes of rooms that still exist are kept). draft → fixed: the current plan becomes the new base plan.
fixed → draft: the base stays; the changes list restarts when fixed again. House 98 is `'fixed'`.

### Store (`store.js`, additive)
```js
store.openProject({ basePlan, phase, design, name })   // replaces base plan + design, clears selection, undo history,
        // structure / carpentry selection, active room, walk mode. Emits 'plan' { reason: 'base', changed: all true },
        // the usual 'load' events, then 'base' {}.
store.setPlanPhase('draft' | 'fixed') → bool            // clears undo history; emits 'plan' { reason: 'phase' }
store.saver = fn                                         // autosave target (set by projects.js); null = legacy key
store.on('base', fn)                                     // another project was opened — rebuild what you captured at creation
```
`'plan'` reasons gain `'base'` and `'phase'`. `main.js` rebuilds both views (destroy + create, same proxy object for
every holder: `on`, `addOverlay`, `setCarpentryDrag`, `setActive`, `showCarpentry` are replayed) on `'base'`, so cameras,
site, sun, walk state and daylight caches start fresh.

### Plan builder (`plan-build.js`) — for the sketch importer
```js
import { buildPlan, emptyPlan, DEFAULT_LOCATION, DEFAULT_HEIGHTS } from './core/plan-build.js';
const { ok, plan, warnings } = buildPlan({ walls, openings, meta, heights, site, outdoorAreas });
```
* Input in plan space (cm, +x east, +y south, origin = the house's outer NW corner — the plan is shifted there if needed,
  with an `info` warning). `walls`: exactly the shapes of `PLAN.walls` (`{ x, y, w, h, kind?, id? }` or `[x, y, w, h, kind]`),
  or an axis-aligned centre line `{ x1, y1, x2, y2, thickness }`. `openings`: the shapes of `PLAN.openings` (`kind`, gap
  rectangle `x, y, w, h`; `axis`, `width`, `height`, `sill`, `style`, `hinge`, `swing`, `id` are optional and defaulted).
* **Orthogonal, one floor.** Diagonal / curved / polygon walls and other floors are `error`s ("…the plan engine is
  orthogonal…") and left out; openings that are not in a wall, overlap, or lack 10 cm of jamb are `error`s and left out.
* Output: `plan` is always complete (`PLAN_KEYS`): derived `walls` (clean rectangles, ids `wNN`), `wallOutline`, `bounds`,
  `openings` (with `rooms`, `exterior`, `outside`), `rooms` (enclosed regions → polygon, label; first-guess name / type:
  largest = `'living'` "Living space", others "Room n" — ≥ 6 m² `'bedroom'`, smaller `'service'`), `outdoorAreas` (none by
  default), `site` (rectangular lot around the house: `site.margins` default 3 m each side, or `site.lot { width, depth }`,
  or `site.boundary`; `street.side` default `'e'`; no parking / building line / setbacks unless given), `meta` (defaults:
  name "New house", the built-in house's latitude / longitude / time zone, `northAngle` 0, `floors` 1), `heights`
  (House 98's), `assumptions` (every default used, shown to the user). `ok` = no `error` warnings.
* `warnings`: `[{ level: 'error' | 'warning' | 'info', text, ref? }]`, plain English. Never throws.
* `emptyPlan({ meta, heights, lot, margins, street })` = an empty lot (house drawn later with the Structure tools).
* **Upper floors (stage F1).** `buildPlan(input, { levels: true })` (or while `FEATURES.levels` is on; `{ levels: false }`
  forces today's behaviour) accepts `levels: [{ id?, name?, nameHe?, heights?, walls, openings, voids?, stairs?, slants?,
  elevation? }]` bottom-up: each level is read and derived like L0 (rooms named, outline, opening sides; wall ids
  `L1|wNN`; room and opening ids unique across levels; warnings prefixed with the floor's name), heights default to L0's,
  `elevation` is computed (below's elevation + its ceiling + this slab; a different given value is a warning), the origin
  is the NW corner of all levels, `bounds` their union, `meta.floors` = 1 + levels. Without the option or the flag,
  floors stay an `error` as before. With `passThrough: true` the optional data is now moved with the origin too.
* **Angled walls (stage A1).** `buildPlan(input, { slants: true })` (or while `FEATURES.angledWalls` is on; `{ slants:
  false }` forces today's behaviour) accepts non-orthogonal walls: diagonal centre lines `{ x1, y1, x2, y2, thickness }` in
  `walls`, and the reader's `slants` (§ 11 "the `slants` option": `{ id, x1, y1, x2, y2, t, kind, chain? }`) with their
  openings `{ kind, axis: 'a', wall, at, width, hinge: 'a'|'b', swing: 'l'|'r', … }` in `openings`. They become `plan.slants`
  `{ id: 's01'…, x1, y1, x2, y2, t, kind }` (input order; centre lines on 0.1 cm; kind from the derive; openings re-pointed
  to the new ids): within 0.5° of an axis → a rect wall (its openings → rect openings with compass hinge / swing); free
  ends within 1.5 t of another free end meet at their mean point, other free ends within 1.5 t of a wall face (along the
  centre line) are extended to it (`at` of their openings re-measured, so they keep their place). The whole plan is derived
  with the mixed derive (§ 7 "Angled walls: derive"); the origin includes the slants (whole cm) and moves them too;
  `bounds` include their footprints; `schema: 2`. Upper floors (`levels`) take `slants` the same way. Without the option /
  flag a diagonal wall is still an `error` ("…orthogonal…") and left out.

### Projects (`projects.js`)
```js
import { createProjects, createLocalAdapter, createMemoryAdapter } from './core/projects.js';
const projects = createProjects({ store, adapter });   // main.js: adapter = createLocalAdapter(); window.app.projects
await projects.init();            // first run: migrates the old autosave (localStorage 'e7-interior-design/v1', left in place
                                  // as a backup) into a project named after it, else House 98 + the architect's layout
projects.current() → summary | null          projects.list() → Promise<summary[]> (newest first)
projects.open(id) → Promise<bool>            projects.create(opts) → Promise<{ ok, project?: summary, reason? }>
projects.rename(id, name)  projects.duplicate(id, { open })  projects.remove(id)   // → Promise<{ ok, reason? }>
projects.exportFile(id?) → Promise<{ ok, filename, text }>   projects.importFile(textOrObject, { open }) → Promise<{ ok, project?, reason? }>
projects.save() / flush()   projects.on(fn)  // { type: 'open' | 'list' | 'error' | 'saved', … }   projects.lastError()
```
* **Import wizard:** `await projects.create({ name, fromPlan: buildPlan(...).plan })` → a new project in phase `'draft'`
  (pass `phase: 'fixed'` to skip drafting), opened at once (`open: false` to only store it).
* Other `create` forms: `{ from: 'blank', lot: { width, depth } (cm), location: { name, latitude, longitude, timeZone },
  northAngle, ceiling }` (empty lot, draft) · `{ from: 'house98', ceiling }` (copy of the built-in house with the architect's
  furniture) · `{ from: 'file', file }`.
* Project record: `{ id, name, createdAt, updatedAt, phase, builtin, basePlan, design, thumbnail? }` — `design` is
  `store.serialize()` (plan edits are relative to `basePlan`; in a draft project the drawn walls live there until the plan
  is fixed). Summary = the record without `basePlan` / `design`.
* Project file: `{ app: 'e7-house-designer', kind: 'project', version: 1, exportedAt, project }`. `importFile` also accepts a
  design file from earlier versions (→ a project on House 98). Imports always get a new id.
* **Storage adapter** (replaceable by an online backend, callers unchanged): `{ list() → summaries, get(id) → record | null,
  put(record), remove(id) }`, all async. `createLocalAdapter()`: IndexedDB → localStorage → memory (sandboxed iframe /
  private window: the app runs in memory; a failed save is reported via `on` / `lastError()`, never thrown).
  The open project's id is remembered in localStorage `'e7-projects/current'`. Autosave (400 ms) saves the open project.

### UI (`src/ui/projects.js`)
Project switcher = the project name in the top bar (menu: current project, other projects, New project…, Rename…,
Duplicate, Export project file, Import project file…, Delete project…). Structure guide: phase card (draft → "This is the
house as built…"; fixed own plan → "Back to drafting…"). An empty plan shows a "Draw walls" hint. House-98-only features
(reset to the architect's layout, Carpentry "Start from the architect's layout") are shown only when `isBuiltinBase()`.
Regulations skip with "Not checked: …" findings when a project lacks the data (setbacks, parking, written room areas, a draft plan).

## 11. Sketch import engine (`src/import/`) — pure logic (no DOM except page rendering; runs in a browser, a worker or Node)

Reads a 2D sketch (vector PDF page, or a raster image) and proposes walls and openings in exactly the `PLAN` schema,
ready for `buildPlan` (§ 10). Nothing is drawing-specific: line weights, page size and scale are found per drawing.
pdf.js (vendor/pdfjs/, see its README) is imported lazily on the first read, so the app's initial load is unchanged.

```js
import { importPdfSketch, analysePrims, readPdf, renderPdfPage, detectScale, scaleFromPoints, detectWalls,
         detectOpenings, normalise, readImage, scaleFromImagePoints } from './import/index.js';
const prims = await readPdf(bytes, { page: 1 });          // async: pdf.js (worker from our origin, no eval)
const result = analysePrims(prims, { scale, walls, openings, rotate, mirror });   // sync, plain data in/out → run it in a worker
// or both at once: await importPdfSketch(bytes, { page, scale, walls, rotate, mirror })
```

**`readPdf(bytes, { page })`** → `{ pageCount, page, pageBox: { w, h }, rotate, units: 'pt', paths, texts, images }`.
Page units = PDF points, origin top-left of the displayed page, +y down (= pixels of the page rendered at scale 1).
`paths[i] = { pts: [x0, y0, x1, y1, …] (Béziers flattened, 12 steps), closed, stroke, fill, evenOdd, lw (page units, 0 =
hairline), color, fillColor ('#rrggbb'), dash [], curved, sub, group }`; `texts[i] = { str, x, y (baseline), w, h, angle,
dir }`; `images = [{ x, y, w, h }]`. Many CAD PDFs (both reference drawings) draw their text as strokes: `texts` is then
empty. **`renderPdfPage(bytes, { page, pxPerUnit, canvas?, bitmap? })`** (browser) → `{ canvas, bitmap?, pxPerUnit,
width, height }` — the tracing underlay; place it with `result.transform` (below) scaled by `1 / pxPerUnit`.

**`detectScale(prims, override?)`** → `{ best, candidates: [{ cmPerUnit, ratio (S of 1:S) | null, label, source,
confidence, evidence }] }`. Sources: `user` (override `{ cmPerUnit }`, `{ ratio }` or `{ points: [[x, y], [x, y]], cm }`;
also `scaleFromPoints(p1, p2, cm)`), `text` (a stated scale "1:100", "SCALE 1/50", "M 1:50", 'קנ"מ 1:50'), `dimensions`
(numbers written along thin lines: value ÷ line length, read as cm / m / mm, clustered; ≥ 3 agreeing), `geometry`
(no usable text: every standard metric and imperial scale is scored by plausibility — a wall pen paired at 7–40 cm, door
swings of 60–125 cm, a building of 3–100 m, wall edges on a 5 cm / 1 inch module; confidence ≤ 0.7 and the result
carries a `scale-guessed` warning). `text` / `dimensions` assume the PDF is at true paper size; a "fit to page" print
needs the two-point override.

**`detectWalls(prims, scale, options)`** — options `{ snap: 5, minThickness: 7, maxThickness: 40, maxOpening: 400,
fill: 'auto' | 'parity' | 'pairs', pens: [penKey…], angle, drawing: 0 }`. Wall pens are scored (thick, orthogonal in both
directions, paired with a parallel line of the same pen at a wall thickness; hatch-like one-direction pens score 0;
filled narrow rectilinear polygons count as solid walls); the drawing is deskewed to the walls' orientation; outlines
are merged, a compressed grid is filled by even–odd parity along rows AND columns (both must agree), or — when outlines
are not closed (> 25 % ambiguous; always for raster) — by the bands between parallel wall lines plus corner / junction
squares; cells are sampled onto the snap grid (relative to the drawing's NW corner) and cut into rectangles
**scanline-greedy** (top-most then left-most free cell, extend right, then down — the convention of the hand
extraction: a wall reached first keeps its junction). Pieces thicker than `maxThickness × 1.25` are left out with a
`not-a-wall` warning; non-orthogonal / curved wall-pen lines are reported in `unsupported` with `angled-wall` /
`curved-wall` warnings (never bent or silently dropped). Several separate drawings on one sheet are found
(`drawings`, `several-drawings` warning) and the largest is used unless `drawing` picks another; isolated pieces away
from the building are dropped (`stray-walls`). Exterior: the outside is flood-filled with every evidenced opening gap
closed; a wall whose long side faces it (≥ 20 % or ≥ 40 cm) is exterior, a piece touching it only with its end is
exterior only if it is as thick as the exterior walls. Returns `{ walls (drawing-frame cm), gaps, frame: { matrix
(page → frame cm), angle, cmPerUnit, origin, snap }, pens, fills, unsupported, rejected, drawings, drawing, warnings,
stats, confidence }`.

**`detectOpenings(prims, walls, scale)`** → `{ openings, warnings, stats }`. Gaps: from the free end of a wall run the
wall's band stays empty 25–400 cm and is then closed by another wall, with free space on both faces. `door` = a swing
arc (curved path, polyline, or a hand-dashed arc chained from pieces) of radius 0.7–1.15 × the gap, centred on a jamb
→ `hinge` (that jamb), `swing` (side of the arc); a second arc on the other face → `innerDoor`; two half-width arcs →
`leaves: 2`. `window` = ≥ 2 thin lines along the wall spanning ≥ 70 % of the gap (1 line if the gap is framed by
collinear walls); `sliding-door` = the same in a gap ≥ 200 cm (a convention, confidence 0.5); `opening` (`style
'open'`) = an empty gap framed by collinear walls of the same thickness, ≤ 250 cm, confidence 0.35. Defaults are listed
in `assumed`: doors 210 high (style `entry` ≥ 100 cm / `service` exterior, `interior`), windows 120 high, sill 90
(style `tilt` ≤ 90 cm, else `sliding`). Each opening has `confidence` and `evidence`.

**`normalise({ walls, openings, scale, pageBox }, { rotate: 0 | 90 | 180 | 270 (clockwise), mirror: false | 'ns' | 'ew' })`**
→ `{ walls: [{ id 'wNN', x, y, w, h, kind 'exterior' | 'interior' }], openings: [PLAN opening shape + confidence],
scale, pageBox, transform, rotate, mirror, drawings, drawing, warnings: [{ code, text, where }], unsupported, stats,
confidence: { scale, walls, openings, overall } }` — plan cm, origin at the house's outer NW corner, +y south; the
mirror is applied before the rotation; after either, rectangles are re-cut top-down and exterior / interior
re-derived. `transform = [a, b, c, d, e, f]`: page units → plan cm (`X = a·x + c·y + e`, `Y = b·x + d·y + f`).
`where` boxes are in plan cm. `analysePrims` adds `scaleCandidates`, `page`, `pageCount` and `no-scale` /
`scale-guessed` / `raster-page` warnings.

**Angled and curved walls — the `slants` option** (stage A6 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md; `src/import/slants.js`).
`analysePrims(prims, { slants: true, … })`, `importPdfSketch(bytes, { slants: true })`, `analyseDxf(prims, { slants: true })`
(or `detectWalls(…, { slants: true })` → `detectOpenings` → `normalise`). **Default `false`: the output is exactly the
orthogonal-only result** (byte for byte; angled / curved pieces only in `unsupported`). With `true`:
* **Angled walls**: wall-pen (DXF: wall-layer) lines that are parallel within 1°, overlap ≥ 60 % of the shorter one and
  are 7–40 cm apart (no parallel line between them; a line pairs on one side only) → one slant `{ id 'sNN', x1, y1, x2,
  y2 (centre line, plan cm, 0.1 cm), t (cm, rounded), kind 'exterior' | 'interior' }`. A centre end is the mean of the
  two face ends when they stop within 1.5 t + 2 cm of each other (faces ending on another wall's two faces → the
  centre-line junction; on its near face → on that face), else the end of the overlap. Thin filled parallelograms
  (poché; DXF hatches on wall layers become their boundary lines) are slants the same way. Caps and jamb lines lying on
  a slant are part of it. A free end (touching no rectangle or slant) is extended along the centre line to the nearest
  wall face (rectangle or slant) within 1.5 t. Lines within 1° of an axis are orthogonal as before (so a wall 0.3° off
  is a rectangle; nothing within 0.5° becomes a slant). Unpaired angled lines stay in `unsupported` (`angled-wall`).
* **Orthogonal walls next to slants**: the slant's lines are not part of the parity fill; orthogonal outline lines ending
  on a slant are closed without it — collinear pieces either side are bridged (a wall a slant abuts stays one wall),
  a horizontal and a vertical end meeting inside the slant are extended to their corner, two parallel ends (a wall
  abutting the slant) are closed at the corner that touches the slant first (the design's "rect end on a slant" rule;
  the joint triangle is the plan engine's), short orthogonal caps / jogs on the slant are dropped. Rectangles keep the
  5 cm snap; slants are not snapped. Exterior / interior: the slants are rasterised (cells within t/2 + 0.75 snap of the
  centre line) into the same outside flood fill; a slant is exterior when a face sees the outside along ≥ 20 % of its
  length or ≥ 40 cm (rectangles: unchanged rule, now with the slants closing the envelope).
* **Curved walls**: curved wall pieces (DXF ARC / bulge / ELLIPSE / SPLINE, PDF Béziers as flattened; a PDF path is cut at
  its corners and its straight orthogonal runs go back to the orthogonal fill) that fit circles pair when concentric,
  7–40 cm apart and overlapping ≥ 60 % of the shorter sweep; other curves when one stays at a constant offset (spread
  ≤ 2 cm) from the other. Each band → a chain of slants on the centre curve, vertices on it, tagged `chain: 'cN'` (in
  order along the curve): at least 3 pieces per 90° (≤ 30° each), then refined until the sagitta ≤ 2 cm as long as
  chords stay ≥ 30 cm (when both cannot hold — centre radius under ≈ 58 cm — the 30° rule wins and the deviation is
  reported as it is). Warning `curved-wall-pieces` (`severity: 'info'`): "Curved wall drawn as N straight pieces, within
  2 cm (largest deviation d cm)"; `stats.curveMaxDev` = the largest sagitta. Translated copies of an arc (thickness
  varying along the wall) do not pair and stay `unsupported`. Openings in curved walls are not detected.
* **Openings in slants**: two collinear slants (thickness ±1 cm, direction within 1°, centre lines < 2 cm apart) with a
  gap of 25–400 cm become one continuous slant and an opening in the PLAN shape "opening in a slant": `{ id, kind,
  style, width, height, sill, wall: 'sNN', axis: 'a', at (cm from x1, y1 along the centre line to the opening centre,
  0.1 cm), hinge: 'a' | 'b' (jamb nearer the start / end), swing: 'l' | 'r' and outside: 'l' | 'r' (sides relative to
  x1 → x2; 'r' = the right-hand normal (−uy, ux) on screen), exterior, assumed, confidence }` — evidence and defaults
  as for orthogonal gaps (arc of 0.7–1.15 × the gap centred on a jamb → door, innerDoor / two half leaves; thin lines
  parallel to the slant spanning ≥ 70 % → window, ≥ 200 cm → sliding door; an empty gap ≤ `maxPassage` → passage
  `opening` / `open`). A face line running on across the gap means a junction: the pieces join, no opening. Opening ids
  continue the orthogonal counters (`door-n`, `win-n` …); in `openings` they follow the rect openings, by wall then `at`.
* **`normalise`** maps centre lines through the same mirror, rotation and shift as the rectangles (origin = the
  rectangles' NW corner, as before), swaps `l` ↔ `r` (swing, outside, innerDoor) under a mirror, then turns every slant
  (a chain as a whole) to start at its northern end (west on a tie) — `at` from the new start, hinge `a` ↔ `b`, sides
  `l` ↔ `r` — and re-numbers `s01…` / `c1…` north-west first, the openings following their wall. Output `{ walls,
  openings, slants, … }` with `slants` **omitted when there is none** (then the object is today's, also with the option
  on). `stats` gains `slants`, `chains`, `slantOpenings`, `curveMaxDev` only when slants were found; `unsupported`
  shrinks accordingly. `detectWalls` (frame cm) adds `slants`, `slantOpenings`, `chains` when the option is on.
* **Limits** (honest): the drawing needs at least one orthogonal wall (the origin and the grid come from the rectangles;
  slants further north / west than the rectangles get negative coordinates). Two different parallel walls whose
  facing faces are 7–40 cm apart, or wall-pen hatch lines drawn as separate lines ≥ 7 cm apart, can pair into a false
  slant (a line pairs on one side only, the nearer partner first; more than 4 000 angled lines: no slant detection).
  A passage between a rectangle's end and a slant, and openings in curved walls, are not found. Slant ends inside a
  rectangle are left there (the plan engine's joins extend / clip them). With the option on, straight orthogonal runs
  inside a curved PDF path feed the orthogonal fill, so a drawing with such paths can differ from the default run
  even without slants. Tested on generated drawings only.
* **`buildPlan`** takes this output with `{ slants: true }` since stage A1 (§ 10; tested: the Wedge drawing → the same 3 rooms,
  openings and classes as the designed plan); the import dialog keeps treating angled / curved walls as "redraw by hand"
  (it does not pass the option) until the switch is on.
* Measured (tests/import.test.mjs, tests/import.dxf.test.mjs; fixtures in tests/import-slant-fixtures.mjs): the design's
  "Wedge" drawn as the union outline of its walls with door swings and glass lines, as PDF-like primitives and as DXF —
  both slants on the design centre lines (end points ≤ 0.05 cm off the lines), thickness exact, kinds right; the window
  in s01 and the door in s02 at their design positions (≤ 0.1 cm), hinge / swing / outside right; rectangles = the
  design's (symmetric difference 0) and identical to the drawing of the rectangles alone; rotation by 90°, both mirrors
  and 270° + mirror consistent; a wall abutting s01 stops at its first corner on s01's face and s01 stays one slant
  across the junction; s02's gap drawn without a swing → a passage. A quarter-circle wall of centre radius 300 cm → 7 pieces, chord 67 cm, largest deviation
  from the true circle 1.9 cm (PDF Béziers and DXF ARC / bulge alike). Lot 98 / lot 99 give the same output with the
  option on (no angled wall pieces there). Cost: nothing on the default path (lot 98 detectWalls + detectOpenings +
  normalise ≈ 50–70 ms before and after, within the noise); with the option ≈ 5 ms more on lot 98 (thin angled lines
  collected for window evidence).

**`readImage(image, { cmPerPx? | points + cm, deskew = true, propose = true, threshold?, walls?, rotate?, mirror? })`**
(raster: PNG / JPG / a scanned page rendered to pixels; `image` = ImageData-like `{ width, height, data }` or
`{ width, height, gray }`) → `{ threshold (Otsu; coloured pixels never count as ink), deskew: { angle (drawing's tilt,
clockwise °), confidence }, scale, strokes: { thin, thick } px, prims (vector-like strokes of the deskewed image),
toImage, proposal, warnings }`. `proposal` (only with a scale; `scaleFromImagePoints(p1, p2, cm)`) is a `normalise`
result with `lowConfidence: true`, wall confidence ≤ 0.4, opening confidence ≤ 0.3, and `imageTransform` (image px →
plan cm). Strokes come from run-length analysis (centre line of each horizontal / vertical ink run, width = run
thickness; ≥ the minimum wall thickness at that scale → a solid wall), then the vector engine runs with pair filling.

**What is exact and what is not.**
* Exact: vector PDFs with orthogonal walls drawn as closed outlines (or solid fills) at a known scale. Measured on the
  owner's drawings (tests/import.test.mjs): lot-98 site plan → 53 rectangles for plan.js's 55, every plan wall within
  5 cm, wall area identical (144 050 cm², symmetric difference 0), 52 rectangles identical; the 3 others are one
  straight run (x 340, y 890–1380) that plan.js splits by meaning (partition / safe-room shell / exterior) — the
  drawing does not distinguish them. All 23 openings found with the right kind, every door's hinge and swing right, the
  safe-room door's dashed inner leaf found as `innerDoor`, no extra openings. Lot-99 dimension sheet (two drawings on the
  sheet; mirror `'ns'`): the same for both drawings; the dimension plan's living-room north window is 5 cm further west
  than on the lot-98 sheet (plan.js notes this; the lot-98 sheet wins).
* Not inferable from drawing geometry: `kind: 'mamad'` (the safe-room walls are hatched like every other wall; they
  come out exterior / interior), window heights / sills, sliding vs. hinged door styles beyond the stated conventions,
  room names. One hand-labelled piece (lot 98 `w52`, a 10 cm stub in the south wall) differs in exterior / interior.
* Scale: the reference PDFs carry no text objects (all text is stroked), so their 1:100 comes from geometry (confidence
  0.48, flagged); the UI should ask the user to confirm or measure a known distance.
* Openings drawn over continuous wall lines (no gap in the outline) cannot be found. Doors without swing arcs come out
  as passages. Angled / curved walls are reported, not converted (with the `slants` option: converted, see above).
  One floor per page; several floors on one sheet are
  separate `drawings` (pick one). Furniture or fixtures drawn with the wall pen and closed can be mistaken for walls when
  ≤ 50 cm thick; thicker ones are rejected with a warning.
* Raster is a proposal, never exact: on House 98 rendered at 150 dpi (scale from two picked points) 75 % of the wall
  area is found, 99.7 % of what is found lies within 5 cm of a real wall, but only 11 / 55 rectangles are identical;
  openings are rarely right (no arcs in raster). Deskew estimate on a 3° tilted page: 3.0°.
* Cost (Node, lot 98, 51 k paths): readPdf ≈ 0.7 s, scale ≈ 1 s (geometry path), walls + openings ≈ 0.2 s;
  `analysePrims` is synchronous plain-data work — run it in a worker.

### 11.1 DXF (`src/import/dxf-read.js`, `dxf.js`, `dxf-render.js`) — AutoCAD drawings with true units and layers

```js
import { readDxf, firstLook, analyseDxf, dxfScaleCandidates, proposeLayers, renderPrims } from './import/index.js';
const prims = readDxf(bytes);                     // sync, pure JS, no dependency: Node, worker or page
const { candidates, layers } = firstLook(prims);  // unit candidates + proposed layer roles
const result = analyseDxf(prims, { candidates, layers, roles: { 'A-WALL': 'wall', … }, scale: { cmPerUnit }, walls: { drawing }, rotate, mirror });
renderPrims(prims, { pxPerUnit, canvas?, crop?, hide?: Set<layer>, highlight?: Set<layer> });   // browser / worker canvas
```

**`readDxf(bytes | string, { cmPerUnit? })`** reads **ASCII DXF R12 … 2018** (binary DXF and DWG are refused with a
plain message) and returns the **same primitive structure as `readPdf`** — `{ pageBox, paths, texts, images: [] }`, every
path / text with its `layer` — plus `kind: 'dxf'`, `dims`, `inserts`, `blocks`, `layers`, `layouts`, `extents`,
`skipped`, `warnings` and `dxf: { units: { code ($INSUNITS), name, cmPerUnit | null, measurement, dimlfac, version,
codepage }, unitGuess, duPerPageUnit, cmPerPageUnit, toPage (drawing units → page units) }`.
* **Page units**: the model space laid out as if printed at 1 : 50 (one page unit = 50 × 2.54 / 72 cm of building),
  y flipped to the engine's +y-down convention, a 20-unit margin — so every PDF-tuned threshold of the detectors works
  unchanged. Line weights (code 370, by layer / block, default 0.25 mm) become paper points; linetypes with gaps → `dash`.
* Read: HEADER (`$ACADVER`, `$INSUNITS`, `$MEASUREMENT`, `$EXTMIN/MAX`, `$DIMLFAC`, `$DWGCODEPAGE`), TABLES (LAYER colour
  ACI / true colour, off, frozen, linetype, line weight; LTYPE dash pattern), BLOCKS, OBJECTS (LAYOUT names), ENTITIES:
  LINE, LWPOLYLINE / POLYLINE + VERTEX (bulges → arcs, split from the straight runs; wide polylines → filled bands; mesh
  polylines skipped), ARC, CIRCLE, ELLIPSE, SPLINE (NURBS, de Boor, flattened; fit points when no control points),
  INSERT (nested to depth 16 with cycle guard, scale, rotation, MINSERT arrays, mirroring by negative scale or OCS
  extrusion (0, 0, −1), ATTRIBs, layer 0 / BYBLOCK / BYLAYER inheritance), TEXT / ATTRIB (alignment), MTEXT (formatting
  codes stripped, paragraphs → lines, `\U+XXXX`, `%%c/%%d/%%p`), DIMENSION (its *D block drawn; definition points 13 / 14
  give the measured length, code 42 / the text override the value shown → `dims`), HATCH boundary loops (polyline
  and edge loops: line, arc, ellipse, spline) and SOLID / TRACE as fills, 3DFACE outlines, LEADER lines. Entity
  extrusions other than ±Z are not transformed.
* Encoding: R2007+ UTF-8; older files by `$DWGCODEPAGE` (ANSI_1255 Hebrew, ANSI_125x, DOS862 Hebrew, ISO 8859-x, CJK
  pages); none stated → UTF-8 if valid, else Windows-1255 when the high bytes are Hebrew letters, else Windows-1252.
* Model space only; paper-space entities are counted and the layouts listed (`dxf-paper-space` warning); a file whose
  drawing is only in paper space gets a plain error. Not drawn and reported (`dxf-skipped`, `dxf-xref`): 3D solids /
  regions / meshes (ACIS), images, wipeouts, proxies, tables, XREFs (not bound), XLINE / RAY.
* Plain errors (`err.plain`, `err.code`): `dxf-binary`, `dxf-truncated` (no EOF, the file stops inside a section),
  `dxf-damaged` (a group code that is not a number), `dxf-not-dxf`, `dxf-empty`, `dxf-too-big`.
* Streaming: the bytes are scanned in place (no whole-text decode, no array of lines) and each entity is interpreted as
  soon as it ends; 20 MB (≈ 180 k entities) reads in ≈ 1.3 s in Node with ≈ 130 MB of heap during the read and ≈ 50 MB
  held by the result (tests/import.dxf.test.mjs). In the app it runs in the import worker.

**Units → scale** (`dxfScaleCandidates`): one candidate per plausible unit (mm, cm, m, inch, foot, dm; the declared one
if unusual), `cmPerUnit` in page units, `cmPerDrawingUnit`, `label` "1 unit = 1 cm", `source` `units` (declared) /
`dimensions` / `geometry`, `confidence`, `evidence { declared, dimensions: { agree, of }, extentM, wallThickness, doorArcs,
doorSized }`. Scored by the declared unit (×4), DIMENSION values (the number shown, read as cm / mm / m, must equal the
measured length in that unit, ±1.5 %), and plausibility (building 2.5–150 m, wall pairs 7–45 cm, ~90° arcs 55–130 cm).
A declared unit that the dimensions and proportions contradict (the common `$INSUNITS` = mm on a cm drawing) loses,
with a `dxf-units-doubt` warning. Unitless → `dxf-unitless` warning, the candidates come from dimensions / geometry and
the UI asks for confirmation.

**Layers** (`proposeLayers`, `firstLook`): role `wall` | `door` | `window` | `other` with `reason`, from (1) names, Hebrew
and English and a few European (WALL(S), A-WALL*, S-WALL, MUR, WAND, PARED, קיר, קירות / DOOR, A-DOOR, דלת, דלתות, PORTE,
TÜR / WINDOW, GLAZ, A-GLAZ, חלון, חלונות, FENSTER, FENÊTRE), (2) block content (layers whose inserts are door / window
blocks: by block name, or a block with a ~90° arc and a line), (3) wall hatches (≥ 4 fills of wall thickness), (4)
geometry (the layer whose lines pair up at a wall thickness, by `scoreWallPens`). Hidden layers default to `other`.
`firstLook` = names → candidates with the wall layers' extent / thickness → roles again at the best scale.

**`analyseDxf`** runs the unchanged `analysePrims` on the layers that matter: wall / door / window layers (and, when no
door / window layer is known, every visible layer whose name is not dimensions / text / furniture …); fills only from
the wall layers. The wall pens are passed as `walls.pens` (the existing override): all pens of the wall layers, or —
when a wall layer also holds door swings — the engine's own pick among them. Walls drawn only as hatches / solids
(little line work on the wall layers) are turned into the boundary of their union (even–odd per hatch, union across
hatches) so rectilinear poché of any shape reads exactly (`hatchOutlines`). Openings carry `evidence.block` (the block
inserted there). Result = `analysePrims` result + `scaleCandidates` (DXF), `layers` (with roles), DXF warnings.
`penKey` gains the layer for DXF paths (`lw|colour|dash|layer`); PDF / raster paths have no layer and keep their keys,
so the PDF results are unchanged byte for byte.

**Accuracy** (tests/import.dxf.test.mjs, fixtures generated from `PLAN` by tests/dxf-writer.mjs / dxf-fixtures.mjs:
walls as closed LWPOLYLINEs, doors as a leaf + arc block inserted rotated / mirrored (negative scale and OCS), the
safe-room inner leaf dashed, windows as a block scaled into the gaps): in cm (R2018), in cm with Hebrew layer names
(R2000, ANSI_1255) and in mm — scale exact from the units, wall area identical to plan.js (symmetric difference 0), all
23 openings with the right kind, width, hinge and swing (inner leaf included), no extras. Also exact: walls only as one
hatch per wall piece, or one ANSI31 hatch with the rooms as holes; walls on a layer whose name says nothing (found by
geometry); two plans side by side (`drawings`, either chosen); R12 POLYLINE / VERTEX without units (mm worked out from
dimension texts written in cm). A bulged wall and a 30° wall on the wall layer are reported (`curved-wall`,
`angled-wall`, `unsupported`) with the orthogonal walls unchanged.

**Honest limits.** Tested only on generated files, not on real architects' DXFs: dynamic blocks (anonymous `*U`
blocks are expanded as written, their parameters ignored), annotative scaling, MLEADER / TABLE content, multileader
text, field codes, non-planar entities, OCS extrusions other than ±Z, very old R12 files without TABLES (layers then
default to colour 7), and DXF written by non-Autodesk tools may hold surprises. Doors are found from their drawn arcs
(block geometry included) — a door block drawn without a swing arc gives a passage; window blocks must draw lines
along the wall. Curved and angled walls are reported, not converted (the engine is orthogonal) — unless the caller
passes `slants: true` (§ 11 "the `slants` option"): then wall-layer line pairs, arcs, bulges and wall hatches that form
angled / curved bands become `slants` / chains, measured on the Wedge and quarter-circle DXFs (ARC and bulge) with the
same accuracy as the PDF-like fixtures, and the 30° wall above becomes one slant (the bulged bay, two translated arcs,
stays reported).

## 12. Sketch import UI and tracing underlay (`src/ui/import/`, `src/view2d/underlay.js`) — UI on top of § 10 / § 11

**Entry points:** project menu (top-bar switcher and File → "Projects…") → "Import a sketch…"; New project dialog →
start from "From a sketch (PDF or image)" → "Choose the drawing…". `openSketchImport(app, { name? })` in
`src/ui/projects.js` loads `src/ui/import/wizard.js` on first use (the engine and pdf.js stay out of the start-up).

**The dialog** (`openImportWizard`, one large dialog, single column on phones; nothing is created before step 5):
1. *Drawing* — `<input type=file>` or drag-and-drop onto the dialog; PDF / PNG / JPG, read locally (`source.js`:
   magic-number sniffing, size limits, plain-language errors for encrypted / damaged / unsupported files). Multi-page
   PDF → page thumbnails. A vector page is read (`readPdf`) and analysed once without a scale (scale candidates,
   `drawings`); several drawings → outlined on the page, the user clicks one. A page that is a scanned picture is
   rendered to pixels and handled like a photo.
2. *Scale* — must be confirmed: "Measure a known length" (two clicks, loupe ×4, snaps to vector line ends; type the
   length), the stated scale (`text` / `dimensions` candidate), "1 : N" (PDF at paper size; pictures: + dpi), the
   `geometry` guess labelled with its confidence in words. Live read-out: house size and a typical door at that scale.
3. *Orientation* — rotate 0/90/180/270, mirror (`'ns'` / `'ew'`), north (drag the arrow or type degrees →
   `meta.northAngle`), location and ceiling (`placeFields()` / `ceilingField()` shared with New project).
4. *Review* — `analysePrims` (vector) / `readImage` (raster) at the confirmed scale and orientation, drawn over the page:
   exterior / interior walls, doors with swing, windows, passages, `unsupported` pieces dashed amber with the
   "redraw by hand as straight walls" explanation; counts; engine warnings; page / detection toggles. Raster →
   "A starting point to trace over" banner. Fewer than 4 raster wall pieces count as nothing found.
5. *Create* — name → `buildPlan` (warnings listed; errors → "Create anyway" with what was understood) →
   `projects.create({ name, fromPlan, underlay })` → draft, Structure mode, "what next" card. Nothing found → an
   empty draft whose lot is the picture's extent, with the underlay, to trace by hand.

Heavy work runs in a module Web Worker (`src/ui/import/worker.js` via `engine-client.js runTask`: one worker per task,
terminated on Cancel; falls back to the main thread when workers are blocked). pdf.js parsing runs in pdf.js' own worker.

**Underlay** (`store.underlay`, CONTRACT § 10 project record field `underlay`):
```js
{ image: 'data:image/webp…' | 'data:image/jpeg…',   // ≤ 2400 px long side; a PDF is re-rendered and cropped to the house + margin
  width, height,                                      // stored px
  transform: [a, b, c, d, e, f],                      // stored image px → plan cm (X = a·x + c·y + e, Y = b·x + d·y + f)
  opacity: 0…1, visible: bool, source: { kind: 'pdf' | 'pdf-scan' | 'image', name, page, lowConfidence } }
store.setUnderlay(obj | patch | null, { transient?, replace? })   // emits 'underlay' { reason, transient }; autosaves unless transient
store.openProject({ …, underlay })                                // projects.js passes the record's underlay
```
* Not part of `store.serialize()`, the undo history or the undo snapshot; saved on the project record by
  `projects.save()` (snapshot adds it), so it survives reload, duplicate and export / import of the project file, and
  works with the in-memory adapter.
* Drawn by `src/view2d/underlay.js` in `paintUnder` after the room floors and grid, under walls (multiply in light
  themes, inverted / screen in dark); skipped when `env.exporting` (PNG export), never in 3D or thumbnails.
* Structure guide card (`underlay-panel.js underlayCard`): show / hide, strength, "Re-align…" (scale from two points +
  real distance keeping the first point fixed; move by clicking a drawing point then the plan's wall corner; nudge
  east / south), "Remove sketch".

Tested by `tests/import.ui.test.mjs` (lot-98 PDF through the dialog → walls within 5 cm, 23 openings, 9 rooms, the
underlay's ink within 3 cm of the page rendered with the engine's own transform, built-in project untouched, reload;
a PNG rendering; a broken file; a blank picture).

**DXF in the dialog** (additive). The picker and the drop zone accept `.dxf` (and `.dwg`); `source.js sniff` →
`'dxf'` (text starting with `0 / SECTION` or `999`, binary DXF sentinel, or the extension) / `'dwg'` (`AC10xx` magic or
the extension). Step 1 for a DXF: `engine-client.js` task `dxf-read` (worker: `readDxf` + `firstLook`), the drawing
rendered with `renderPrims` (layer colours on white, too-light colours darkened) into the same viewer, then
`dxf-analyse` (worker: `analyseDxf`) for the drawings and the size read-out; the side column shows **Layers**: colour,
name (as written, `dir="auto"` — Hebrew right-to-left), what it holds and why it was proposed, and a Walls / Doors /
Windows / Other select pre-set by the proposal; pointing at (or focusing) a row highlights that layer on the drawing;
changing a role re-runs the first analysis. Several plans in model space → the existing "Which drawing?" chooser.
Paper-space layouts are listed as not read. Step 2: the first option reads "The file is drawn in centimetres (1 unit =
1 cm)" (or "The drawing is in millimetres …" from dimensions when the file has no units), pre-chosen when confident;
"Measure a known length"; "Choose the drawing unit" (mm / cm / m / inch / foot); a geometry guess when nothing better
exists; the same live sanity read-out. Steps 3–5 as for a PDF (`dxf-analyse` with the confirmed scale, roles, drawing,
rotation, mirror). The stored underlay is a fresh `renderPrims` rendering of the house + margin (all visible layers,
≤ 2400 px) with `source: { kind: 'dxf', name, units }`. **DWG**: never parsed (no DWG library — licensing is the owner's
decision); the dialog explains that DWG is AutoCAD's closed format and how to get a DXF in a minute (Save As → DXF in
AutoCAD and most CAD programs, the free ODA File Converter, or ask the architect), and Next stays disabled. Worker
errors keep `plain` / `code`, so DXF problems show their plain message. Tested by the DXF part of
`tests/import.ui.test.mjs` (DWG explained, binary DXF refused, Hebrew layer panel pre-ticked and highlighted, units
option first and chosen, project walls identical to the built-in house, 23 openings, 9 rooms, the DXF underlay's ink on
both faces of the north wall within 3 cm).

## 13. Live collaboration (`src/collab/`, `dev/collab-server.mjs`) — core

Several invited people edit one **online** project at the same time. A project is *local* (§ 10, unchanged) or
*online* (lives in a **room** on the server; `projects.openOnline(id)`). Without a backend (`GET /api/health` fails
within 1.5 s: artifact preview, plain static host) nothing of this section is visible and the app behaves as before.

### Synchronised data model — `Doc = { e: { [key]: Entity }, v: { [key]: [seq, cid] } }`
| key | entity | from the store |
| --- | --- | --- |
| `item:<id>` | the item (§ 2) + `@z` (number: drawing order; store order = ascending `@z`, ties by id) | `store.items` |
| `finish:<spaceId>` | `{ floor?, wall?, … }` | `store.finishes` |
| `project` | `store.project` fields | |
| `plan` | `{ phase, base, edits }` — base plan (§ 10), `'draft'`/`'fixed'`, `planState()` (§ 7) | plan engine |
| `run:<id>` | a carpentry Run (§ 8) | `store.carpentry.runs` |
| `carp` | `store.carpentry.settings` | |
| `cimg:<id>` | `{ url }` — large carpentry reference image (≤ 1 MB) | `store.carpentryImages` |
| `underlay` | `store.underlay` without `image`; `img` = asset id, the picture itself goes through REST | `store.underlay` |

`v[key]` = server sequence number and client id of the last change of that entity (tombstones kept after delete).
**Not synchronised:** `store.ui`, selection, undo stacks, presence; everything the engines derive when a value is applied
(`PLAN.wallOutline`, bounds, segments, opening sides, 3D / 2D caches). Derived values that are *stored* inside an
entity (rooms of a plan, a run's worktops, unit item positions) travel only as part of a **guarded** entity (below), so
they are always exactly what an engine computed from the state they replace — never a field-by-field mix.

### Operations
`Op = { k, p: Entity }` (put: create / replace) `| { k, s: { field: value }, u: [field] }` (set / unset fields; a value
replaces the whole field) `| { k, d: 1 }` (delete). A **group** = the ops of ONE user action (one store undo step / one
`begin…commit`), captured by diffing the entities the store's events named (`src/collab/ops.js`).
Transient ops (`tx`, while dragging an item) are broadcast only: never logged, persisted or acknowledged; `tx-end`
tells the others to drop them (the drag's group follows, or nothing on cancel).

### Ordering and conflict rules (applied by the room; clients apply the room's *effective* ops verbatim)
1. The room orders groups: `seq` = previous + 1. Per entity field, **last writer by `seq` wins**.
2. **Deletes win**: a set on a missing entity is dropped; a put on an entity someone else deleted after the group's
   `base` (the last `seq` the author had seen) is dropped.
3. **Guards** (derived by the room, never sent by clients): a group touching `plan` guards `plan`; touching `run:R`, or an
   item whose `carp.runId` is R (before or after), guards `run:R`. If a guarded entity was changed by another client after
   `base`, the **whole group is rejected** (`conflict`). The author's client then: plan edits → re-runs the recorded
   plan-engine calls (`addWall(…)` etc.) on the new plan; if the engine refuses (the wall the door was in is gone) the
   edit is dropped and the author is told why. Carpentry → dropped and told. So a plan / run only ever holds a state an
   engine computed from its exact predecessor.
4. Validation: schema per key, size (group ≤ 1 MB, entity ≤ 1 MB, doc ≤ 32 MB), role (`viewer` → `role`), rate.
   A refused group is rolled back on its author's screen with a toast.
5. Client: optimistic local apply; ONE group in flight; later local groups queue (also offline). A remote group is
   applied with the pending local ops laid over it (pending fields win locally — they will be ordered later). On
   `ack` / `reject` the touched keys are reconciled to `confirmed + pending`. Remote groups are held back while a local
   `begin…commit` is open and applied right after it.

### Wire protocol (JSON text frames, `v: 1`)
Client → room: `hello { cid, since? }` · `ops { gid, base, ops, label? }` · `tx { ops }` · `tx-end {}` ·
`presence { p }` · `versions {}` · `version-create { name }` · `version-restore { id }` · `ping {}`.
Room → client: `welcome { you: { cid, email, name, role, color }, seq, doc? | ops?, peers }` (ops since `since` when
still in the log, else the full doc = **resync**) · `ops { seq, gid, cid, by, ops, label }` · `ack { gid, seq, ops }` ·
`reject { gid, code: 'conflict' | 'invalid' | 'role' | 'size' | 'rate', reason, keys? }` · `tx { cid, ops }` ·
`tx-end { cid }` · `peer { cid, email, name, color, role, left? }` · `presence { cid, p }` · `versions { list }` ·
`role { role }` · `error { code, reason }` · `pong {}`.
Identity (`email`, `role`) comes from the server (Cloudflare Access header `Cf-Access-Authenticated-User-Email`); a name
sent by a client is ignored.

### Presence (never stored, ≤ 15 messages / s per person, the client sends at most every 67 ms)
`p = { pointer: { x, y } | null, sel: itemIds, mode, room, lock: entityKey | null, level? }` (`level`: the floor the person
is looking at, absent = the ground floor — stage F2). Shown: initials + colour in the
top bar (list on click), named pointers in the 2D plan, others' selections outlined in their colour (2D, 3D), their
mode / room. **Soft lock**: while someone drags an item or edits a wall their presence holds `lock`; the others see
"being edited by …" and cannot grab it until it is released or 5 s pass without a presence message from them.

### Undo / redo per person
Each local group keeps its inverse ops. Ctrl+Z applies the inverse of *my* last group as a new group; an entity that
someone else changed or deleted since (per `v`) is skipped and a toast says so. Other people's groups never enter my
stacks. A rejected group leaves the stacks.

### Restore points
Named (`version-create`) and automatic (first change after 10 min of quiet or every 200 groups; the last 20 automatic
ones are kept). Restoring sends the difference to the saved doc as ONE group by the restorer, received by everyone
(and undoable by them like any of their groups).

### Room (`src/collab/room.js`, pure JS: runs in Node and a Durable Object unchanged)
`createRoom({ id, storage, now, limits, record })` (`record` seeds an empty storage) → `await room.load()`,
`room.join(conn)` with `conn = { id, email, name?, role, send(text), close?() }`, `await room.receive(connId, text)`
(call it for one message at a time per room — the dev server chains them), `room.leave(connId)`,
`room.setRole(email, role | null)` (null = removed: the connection is told and closed), `room.record()` (project
record, § 10 shape, + `seq`), `await room.putUnderlay({ type, data, meta }, { email, cid })` → asset id (announced as an
op group), `await room.getUnderlay()` → `{ id, type, data }`, `room.listVersions()`, `room.peers()`, `room.flush()`.
`storage` = async key–value `{ get(key), put(key, value), delete(key) }` (JSON values): `head`, `snap`, `log:<seq>`,
`versions`, `version:<id>`, `asset:underlay`. No timers: everything happens on a message. The log keeps the last 500
groups; a client further behind gets the doc.

### REST (dev server; the Worker exposes the same) — identity from Access (dev server: `?as=` or `X-Dev-User`)
`GET /api/health` → `{ ok, user }` · `GET /api/projects` → summaries the user is a member of ·
`POST /api/projects` `{ record }` → `{ id }` (creator = owner) · `GET /api/projects/:id` → record ·
`DELETE /api/projects/:id` (owner) · `GET|PUT /api/projects/:id/members` `{ [email]: role }` (owner) ·
`GET|PUT /api/projects/:id/underlay` (picture, ≤ 4 MB; PUT = editor) · WebSocket `GET /api/rooms/:id`.
Additions (both hosts): list summaries carry `people: [{ email, name, color, role }]` (who is in the room now) ·
`GET /api/projects/:id/versions/:vid` (any member) → `{ ok, id, items, runs, changes: { total, byType: { [keyType]:
{ added, removed, changed } } } }` = what restoring that point would change (`src/collab/version-summary.js`).
Errors: 401 no identity · 403 role / cross-site · 404 not a member (indistinguishable from "no such project") ·
400 bad body · 413 too large · 503 (Worker) Access not configured — the probe then treats the host as having no backend.

### Files and hooks
* `src/collab/ops.js` — doc, ops, validation, the room's rules (pure). `room.js` — the room. `client.js` — the client
  (adapter-based: works on the store through `bridge.js`, on a plain doc in tests). `bridge.js` — store adapter
  (`@z` drawing order, remote apply with the store's events, plan-engine intents, soft locks, `openDoc(doc)`).
  `online.js` — backend probe, `projects.openOnline(id)` / `projects.putOnline()`, `?online=<id>` in the address opens a room.
  `presence.js` — presence and the collaboration UI (status bar cell, people in the top bar, 2D pointers / selections /
  locks, 3D selection boxes, the "Share" button). `api/health` — static `{ ok: false }` so the probe never
  fails on a static host (copied by `dev/build-site.mjs`). The probe's 1.5 s timeout covers only the wait for the
  answer's headers (a busy page may read the body later). `adapter-online.js` — the § 10 storage adapter over REST
  (`list / get / put / remove` + `members / setMembers / versionSummary`); the controller (`app.collab`) adds `online`
  (that adapter), `linkFor(id)`, `removeOnline(id)`, `leaveToLocal()`, `openShare()`, `openHistory()`.
* UI (`src/ui/collab/`, loaded with the controller): `share.js` (Share dialog: put online, link, people + roles, add /
  remove, keep a local copy), `history.js` (restore points: list, save now, summary, restore with confirmation — a
  "Before restoring …" point is saved first), `index.js` (view-only banner + `.app.is-viewonly` disabling editing tools,
  restore / role / removal notices). Styles: `src/styles/collab.css`. Project menu (`src/ui/projects.js`): "On this
  device" / "Online · owned by me" / "Online · shared with me" (role, who is in it), Share…, History…, Delete online
  project… (owner) / Leave this online project — only when a backend answered.
* Cloudflare host (`server/`, see `server/README.md`): one Worker serving `dist/site` (static assets with `_headers`) and
  `/api/*`; `ProjectRoom` Durable Object per project wrapping `room.js` (SQLite storage through `{ get, put, delete }`,
  values split into ≤ 512 K-character pieces; WebSocket Hibernation API, sockets re-joined silently after eviction);
  `ProjectIndex` Durable Object for owners / members / roles. Identity: the verified `Cf-Access-Jwt-Assertion` only
  (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`); `DEV_AUTH=1` (localhost only, refused next to Access or with `PRODUCTION=1`)
  accepts `X-Dev-User` / a `dev_user` cookie for local runs. WebSockets need a same-origin `Origin`.
* Store (additive): `store.collab = { undo, redo, historyState, batchEnded, planIntent } | null` — set by the bridge;
  `commit()` / `cancel()` call `batchEnded()`; `undo()` / `redo()` / `historyState()` delegate while it is set.
  `normalizeItem` is exported. Plan engine: `bindPlanHost({ …, intent(name, args) })` — each successful top-level
  mutation (`addWall` … `resetPlan`) is reported, so a rejected plan edit can be re-run on the newer plan.
* Projects (additive): `projects.detachForOnline(summary)` (local saving stops; emits `'closing'`),
  `projects.onlineOpened(summary)`, `'closing'` is also emitted before a local project replaces the store (the session
  lets go first). `current()` returns the online summary (`online: true`) while one is open; rename / export / duplicate
  work on it (export / duplicate = a local copy).
* Events: remote changes emit the usual store events; `'plan'` and `'carpentry'` carry `reason: 'remote'` (or `'phase'`).
* Tests: `node tests/collab.test.mjs` (Node; real-store replicas in worker threads), `node tests/collab.browser.test.mjs`
  (two browsers + a viewer on `dev/collab-server.mjs`; the scenario lives in `tests/collab-scenario.mjs`),
  `node tests/collab.worker.test.mjs` (JWT / storage / hibernation unit tests, then the same scenario, REST roles, room
  isolation and a runtime restart under `wrangler dev`; needs `npm ci --prefix server` once).

## 14. Polygon kernel and slant geometry (`src/core/polykernel.js`, `src/core/slant-geom.js`) — core, pure logic

Stage A0 of `docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md`. Since stage A1 they are used by the mixed derive (`plan-edit.js`
through `src/core/slants.js`), `geometry.js` (slant footprints, frames) and `levels.js` (footprints) — see § 7 "Angled
walls: derive". Library: `vendor/clipper/clipper.js` (Clipper 6.4.2,
Boost licence; ES module, pure ASCII, no `eval`, no globals — see `vendor/clipper/README.md`). Tests:
`node tests/polykernel.test.mjs`; shared test houses (Wedge, Duplex) in `tests/fixtures/houses.mjs`.

### Units, precision, conventions
* In and out: plan **centimetres** (floats). Inside, coordinates are rounded to integers of **0.01 mm** (`SCALE` = 1000
  per cm): results are multiples of 0.001 cm, and whole-cm input comes back exactly (House 98 is reproduced bit for bit).
  Exact fast path while |coordinate| ≤ `MAX_EXACT` = 47 453 cm (±474 m); further out it is exact but slow. A rounded
  intersection vertex moves ≤ 0.0005 cm (area effect < 0.5 cm² per vertex on a 10 m edge).
* **Shapes** (inputs): a ring `[[x, y], …]` (any orientation), a rect `{ x, y, w, h }`, `{ poly }` (a slant),
  `{ polygon }` (a room), an expolygon `{ outer, holes }`, or a (nested) array of these. Every ring / rect is a solid;
  holes exist only inside an expolygon.
* **Results**: arrays of expolygons `{ outer, holes }`. `outer` is clockwise on screen (positive Σ x1·y2 − x2·y1) and
  starts at min y, then min x — the engine's room-polygon convention; holes are counter-clockwise, start at min x then
  min y, sorted by that vertex; the list is sorted by the outer start vertex (y, x), then larger area first. No
  duplicate or collinear vertices; rings are strictly simple (regions that meet at one point are separate expolygons,
  like the engine's 4-connected cells). Output order depends only on the geometry, not on the input order.

### `polykernel.js`
* `union(shapes)`, `difference(a, b)`, `intersection(a, b)` → expolygons; `intersectArea(a, b)` → cm².
* `offset(shapes, delta, { join: 'miter' | 'square' | 'round', miterLimit = 2, arcTolerance = 0.25 })` → expolygons;
  `delta` > 0 grows, < 0 shrinks (an empty result = nothing that wide: the A2 "min clear 60" test is
  `offset(room, -30).length === 0`).
* `area(ring)` signed (+ = clockwise on screen); `netArea(shapes)` (holes negative); `bounds(shapes)`; `rings(expolys)`;
  `rectRing(r)`.
* `pointInPolys(x, y, shapes)` → `1` inside, `0` outside, `-1` on a boundary (truthy).
* `faces(solids, bbox?)` → `{ outdoor: [{ outer, holes }], rooms: [{ outer, holes, area }] }` — faces of the complement
  of the solids inside `bbox` (default: their bounds + 100 cm). Faces touching the frame are outdoors, the others rooms.
  Same semantics as the grid engine: pass openings as solids (they separate rooms); an enclosed courtyard is a room.
* `normalise(ring, { hole })` — engine form: duplicates and straight collinear vertices dropped (slit spikes kept),
  oriented and rotated as above.
* `slitJoin(outer, holes)` — polygon with holes → the single ring with zero-width slits the app's rooms use (each hole,
  by its first vertex (x, y), joined by a horizontal slit leftwards to the nearest upward edge). Identical to
  `plan-edit.js` `roomPolygon` for rectilinear rooms (tested on rooms with 1–3 free-standing walls).
* Shadow equivalence (tested): `faces(PLAN.walls + PLAN.openings)` gives House 98's 9 rooms with symmetric difference
  0 and identical vertices; the outdoor face touches every exterior wall; "touches the outdoor face" reproduces the
  engine's exterior class of every segment (safe room excluded). Union + faces of House 98: ≈ 1 ms in Node.

### `slant-geom.js`
A slant is `{ id, x1, y1, x2, y2, t, kind, … }` (centre line + thickness, cm). `u` = unit direction x1→x2; the
**right-hand normal on screen** `n = (−uy, ux)` points to side `'r'` (wall running east → `'r'` is south); `at` = cm
along the centre line from (x1, y1).
* `slantFrame(s)` → `{ x1, y1, x2, y2, len, ux, uy, nx, ny, t, hw, angle }`; `pointAt(s, at)`, `atOf(s, x, y)`,
  `offsetOf(s, x, y)` (signed, + = `'r'`), `sideOf(s, x, y)` → `'l' | 'r' | null`; `faceLines(s)` → `{ l, r }` (each from
  the x1 end to the x2 end); `distToCentre(s, x, y)`; `distToWall(s, x, y)` (0 inside; uses `s.poly` when present).
* `freePoly(s)` — square (butt) caps through the end points. `openingQuad(s, at, width)` — the gap quad through the
  whole thickness.
* `joinSlants(slants, rects = [])` → `[{ …slant, poly }]` in input order: the joined footprint, computed from centre
  lines, `t` and the rects only (order-independent, idempotent; an existing `poly` is ignored).
  `slantJoins(slants, rects)` → per slant `{ id, ends: [{ type, with }, …], fills: [rectIndex…] }` for inspection
  (`type`: `free | mitre | bevel | multi | tee | rect | degenerate`).
  Rules (constants `JOIN_EPS` = 1 cm, `MITRE_LIMIT` = 3):
  - ends of different slants within 1 cm form a junction; each wall keeps the wedge between the rays from the junction
    point to the mitre points with its neighbours, so 2, 3 or more walls tile the junction with no gap and no overlap
    (2 walls: the classic mitre line; ≥ 3: the star of the mitre points — the design's "hull piece", without the
    poke-out a non-convex hull would add). An outer mitre longer than 3 t (t of the thicker wall; equal t: inner angle
    < 19.2°) is bevelled by the chord between the two face end points;
  - an end whose centre line meets another slant's centre line within its length, stopping at most `t` short of it
    (or overshooting by at most `t`), is cut along that centre line (T);
  - an end whose centre ray enters a rect within the same reach is cut at the face it enters, and the part inside the
    rect is added clipped by the rect: it reaches the far face and never pokes out (beyond the far face or the rect's
    ends);
  - a rect whose end face (short side) heads into a slant with its nearest corner at most the slant's `t` from the
    near face stays a rect; a joint fill (the rect's extension along its sides to the slant's centre line, clipped to
    the slant's length) is added to the slant's `poly` — gap-free where the design's "projection hull" leaves a notch;
  - otherwise the end is free (square cap).
  Shared junction points are snapped so neighbouring pieces share edges exactly after rounding (their union has no
  hairline gaps; tested on 1000 random cases, and by rotation invariance of a 4-slant room within 1 cm²).

### Limits (A0)
* A slant shorter than 1 cm keeps its free footprint and takes part in no join. Slant ends more than 1 cm apart are not a
  junction (the editor / import must snap them). A T join and a rect-end joint fill need at least 5° between the walls.
* Walls overlapping along their length (parallel, collinear) are not merged into one wall; their union is still exact.
* Curved walls are polylines of slants (A6). Openings across a junction or in a joint fill are not supported (§ 5).

## 15. Stairs (stage F4a, additive — `src/core/stairs.js`, `src/regulations/stairs.js`, `src/view3d/stairs.js`)

Plans without stairs are unchanged (no finding, no mesh, no group). Design: docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 2
"Stair", § 3 "Stairs (F4)". The numbers are sourced in docs/REGULATIONS.md § 1.14.

### Data (on the stair's bottom level: `plan.stairs` for L0, `plan.levels[i].stairs` above)
```js
{ id: 'st1', to: 'L1', shape: 'straight' | 'L' | 'U', x, y, rot, width: 100, risers: 18, going: 29,
  landing?: { at: 9, size: 100 }, turn?: 'left' | 'right', gap?: 0, nosing?: 3, guard?: false, handrail?: false }
```
* `risers` = the count from the lower finished floor to the upper one; the riser height is **derived**:
  `riser = rise / risers`, `rise = levelElevation(to) − levelElevation(bottom level)`. `to` absent = the next level up.
* `going` = nosing to nosing; `width` = clear width of every flight. Each flight of m risers has m − 1 treads; its last
  riser lands on the landing / upper floor. Straight run without landing = (risers − 1) × going.
* `landing.at` = risers below the landing (landing height = at × riser), `landing.size` = depth along the first flight.
  Optional on a straight stair; L / U default to `{ at: ceil(risers / 2), size: width }`. L: `size ≥ width`.
* `turn` (L / U, default 'right'): the side the second flight leaves to, seen walking up the first. `gap`: U well (cm).
* Derived, ignored if stored: `up`, `w`, `d`, `riser`, `footprint` (the test fixture writes them for convenience).

### Direction convention
* The pose is an item pose: `{ x, y }` = centre of the stair's bounding box in its own frame, `rot` clockwise degrees.
  **`rot` 0 = the first flight goes up towards the north (−y)**; 90 east, 180 south, 270 west. Walking up, "right" is
  local +x. `itemCorners({ x, y, rot, w: geo.size.w, d: geo.size.d })` is the bounding rectangle (= the footprint for a
  straight stair or a U); `itemLocalToPlan` / `planToItemLocal` (`toStairLocal`) convert.
* `stairArrivalDir(stair)` → plan unit vector of the last flight (straight: up; L: ±90°; U: back). The F3 void railing
  (`house.js`) opens the void edge facing it — the single source of truth.

### API (`core/stairs.js`, pure; imports geometry.js pose helpers and polykernel only)
* `stairGeometry(stair, { rise })` → `null` (unbuildable) or `{ shape, rise, risers, riser, going, width, turn, gap,
  flights[{ index, risers, firstRiser, h0, h1, length, origin, dir, right, poly, start{a,b,h}, end{a,b,h},
  treads[{ index, h, poly }] }], landings[{ index, at, h, size, poly }], walkingLine[[x, y, h]], walkLength, run,
  footprint (ring, outer of the union), start{a,b,mid,h:0,dir}, arrival{a,b,mid,h:rise,dir}, size{w,d}, treadCount }`.
  Plan cm; h = cm above the lower finished floor; tread `index` = the riser it stands on.
* `floorHeightAt(stair, geo, x, y, { stepped })` → walking-surface height (cm) or `null` off the stair. Default:
  interpolated along the walking line (linear per flight from its start edge to its end edge, flat on landings);
  `stepped: true` → the actual tread height. `pitchHeightAt(stair, geo, x, y)` → nosing-line height (landings: their level).
* `headroomEnvelope(stair, geo, { headroom = 210 })` → `{ headroom, pieces[{ kind, index, poly, origin?, dir?, base,
  slope, top }] }`; `envelopeHeightAt(...)`.
* `requiredVoid(stair, geo, { slabUnderside, headroom = 210 })` → rings (plan cm): where the upper slab underside
  (cm above the lower floor = rise − upper `heights.slab`) is less than `headroom` above the nosing line / landing.
  `uncoveredVoid(voids, required)` → expolygons; `voidCovers(voids, required, { tol = 1 cm² })` → bool. A void may be
  enlarged by the user, never made smaller than this.
* `stairSides(stair, geo, lowerLevelView, { near = 5 })` → side runs `{ a, b, wall, piece, index, outward, ha, hb }`
  (flight sides, landing edges; start, arrival and joints excluded; split where a wall of the lower level is within
  5 cm outside → `wall: true`; `ha / hb` = nosing-line heights). A U with a well < 10 cm drops the first flight's inner side.
* `stairProblems(stair, geo?, { rise? })` → `[{ code, en }]` (codes: stair, shape, risers, width, going, rise,
  landing-at, landing-size, turn) — geometric impossibilities, not regulation findings.
* `proposeStair({ rise, shape = 'straight', width = 90, turn })` → `{ shape, x: 0, y: 0, rot: 0, width, risers, going,
  landing?, turn? }`: fewest risers ≤ 17.5 cm, going = round½(62 − 2R) (≥ 26), a middle landing (size = width) for L / U
  and for a straight stair of more than 18 risers. Add `id`, `to` and the pose.
* `SHAPES`, `DEFAULT_HEADROOM` (210), `PROPOSAL` (the limits used).

### Regulations (`regulations/stairs.js`, registered in `regulations/index.js`, category "Stairs")
`checkStairs({ plan })` runs on every stair of every level (`stairsOfPlan(plan)` → `[{ stair, level, to, rise }]`);
findings `<rule>:<stairId>` with `level` (bottom level) and `stairId`. Rules: `stair-geometry`, `stair-riser`,
`stair-going`, `stair-comfort`, `stair-width`, `stair-flight`, `stair-landing`, `stair-nosing`, `stair-headroom`,
`stair-void`, `stair-handrail`, `stair-guard` (fail / pass) and `stair-guard-height` (info — unverified secondary
source). Upper-level voids of a stair: those with `void.stair === stair.id`, else those overlapping its footprint.
`STAIR_LIMITS` exports the numbers.

### 3D (`view3d/stairs.js`, hook in `view3d/house.js`)
* One mesh per stair, `stair:<id>` (group `house-stairs`, created only when a plan has stairs), 3 geometry groups /
  materials: treads (timber plank finish), body (painted: waist, steps, risers, landings), rails (metal like the F3
  railing); `userData { stairId, levelId, parts: { treads, body, rail }: [indexStart, count] }`. Placed at the bottom
  level's elevation; spans 0 → rise (the top nosing strip is flush with the upper floor).
* Closed risers, 4 cm treads with a 3 cm nosing (`stair.nosing`), an 18 cm waist, 20 cm landings. Sides from
  `stairSides`: wall runs get a wall handrail on brackets 0.90 m above the nosing line; open runs a guard (posts ≤ 1.20 m,
  top / mid / bottom rails following the pitch, 0.90 m). The arrival riser is drawn only below the upper slab.
* Shown whenever its bottom level is shown (so also while a level above is the shown one); rebuilt by
  `rebuildPlan()` when stairs, elevations, slab heights or the bottom level's walls change. No selection / hover yet.
* Tests: `node tests/stairs.test.mjs` (geometry, heights, required void, rules, L / U, proposals, headless 3D).

### Notes for F4b (mutations, 2D symbol, drawing tool)
* Store only the data fields above; derive everything else from `stairGeometry` (never store `up`, `riser`, footprint).
  The 2D symbol: `geo.flights[].treads[].poly` (tread lines), `geo.landings[].poly`, `geo.walkingLine` (arrow from
  `start.mid` to `arrival.mid`, plus the "UP" label), `geo.footprint` (outline / hit-test), the bounding box pose for
  handles (`size`), and the cut line convention of your choice. Hidden part above the cut plane is up to F4b.
* `addStair` should seed from `proposeStair({ rise })` and create / grow the upper void to `requiredVoid(...)` (with
  `void.stair = id`); `updateStair` must grow the void when `voidCovers` turns false and must never shrink a user-enlarged
  void below the requirement; `removeStair` should ask about the void. Refuse a stair when `stairProblems` is not empty.
* The 3D view rebuilds on `rebuildPlan()`; a stair-only change on an upper level is picked up through `stairsSig`
  (no per-level shell rebuild needed). Stairs in `plan.levels[i].stairs` are supported by geometry, rules and 3D.

### Notes for F5 (walk)
* Floor under the walker: `floorHeightAt(stair, geo, x, y)` (smooth, along the walking line) + the bottom level's
  elevation; `null` = not on this stair. Reaching `arrival` (h = rise) switches to `to`; below `start` back down.
* Blockers on a stair: its open `stairSides` runs (guards, 0.90 m) and the void railing of the upper level; the lower
  level's walls only while h < the upper slab underside.

