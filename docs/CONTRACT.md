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
analyseWalls(walls, openings, { prevRooms, outdoorAreas }) → { walls, openings, rooms, wallOutline, problems, segments }  // pure
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
  as passages. Angled / curved walls are reported, not converted. One floor per page; several floors on one sheet are
  separate `drawings` (pick one). Furniture or fixtures drawn with the wall pen and closed can be mistaken for walls when
  ≤ 50 cm thick; thicker ones are rejected with a warning.
* Raster is a proposal, never exact: on House 98 rendered at 150 dpi (scale from two picked points) 75 % of the wall
  area is found, 99.7 % of what is found lies within 5 cm of a real wall, but only 11 / 55 rectangles are identical;
  openings are rarely right (no arcs in raster). Deskew estimate on a 3° tilted page: 3.0°.
* Cost (Node, lot 98, 51 k paths): readPdf ≈ 0.7 s, scale ≈ 1 s (geometry path), walls + openings ≈ 0.2 s;
  `analysePrims` is synchronous plain-data work — run it in a worker.
