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

