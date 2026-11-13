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
BASE_PLAN                                   // deep-frozen architect's plan (same shape as PLAN) — for diffing; never changes
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
  'remove-unit' | 'move-unit' | 'adopt' | 'history' | 'load'`. Views re-render carpentry panels / drawings on `'carpentry'`.
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
```
Finding codes: `overflow, underfill, width-range, above-ceiling, no-wall, outside-wall, door-crossing, window-base, window-wall,
window-tall, mamad, wall-filler, corner-filler, end-panel, corner-dead, corner-access, hob-tall, hob-wall, hob-window, hob-landing,
wall-over-hob, sink-landing, sink-corner, prep-zone, no-dishwasher, dishwasher-sink, appliance-door, fridge-niche, fridge-landing,
slab-length, joint-cutout, worktop-joints, overhang-support, overhang-knees, end-overhang, wall-low, wall-reach, hanging-depth,
hanging-height, sliding-min, sliding-max, aisle, door-swing, clash`. Re-run checks on `'carpentry'`, `'items'` and `'plan'`.

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
* Store hook used by the engine only: `store._applyCarpentry(change, opts)`. `Carp.bindStore(otherStore)` for workers / tests;
  read-only functions also take a `src = { carpentry, items }` (e.g. a parsed design file): `checkRun / takeoff / drawings / schedules (runId, src)`, `estimate(runId, { …, src })`, `listRuns(src)`, `getRun(runId, src)`.
