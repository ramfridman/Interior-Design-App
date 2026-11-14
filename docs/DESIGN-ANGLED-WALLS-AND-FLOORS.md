<!-- Engineering reference for the staged work on angled walls and several floors (owner's request of 14 Nov 2026:
     "support all the important possibilities" for sketch import). Produced by a read-only architecture analysis of the
     code; each stage (G1, G2, A0–A7, F1–F8) is implemented and tested separately. Status is tracked in docs/TODO.md. -->

# Design: angled walls and multiple floors for the E7 plan engine

## Summary
- **Key fact.** Every geometry engine in the app is built on axis-aligned rasters:
  - `plan-edit.js`: a coordinate-compressed cell grid for bars, cores, rooms and flood fill.
  - `view3d/house.js`: an irregular grid that emits faces.
  - `daylight/solver.js`: 5 cm voxel columns with 4-sided face charts.
  - `import/walls.js`: H/V scanline fill.
- **Floors** reuse all of these unchanged, one level at a time. Their cost is mostly plumbing: data, UI, stacking, stairs.
- **Angled walls** need a new vector path in every engine.
- **Recommendation:**
  - Keep today's rectangle engine as the fast path. It is untouched whenever a level has no angled walls, so results stay byte-identical.
  - Add a mixed vector path that runs only when a level has angled walls.
  - Do the shared groundwork first (G1, G2).
  - In the core, do floors first. Start the polygon kernel (A0) on day one in parallel: it is the biggest technical unknown and touches no existing file.

---

## 1. Findings

### 1a. Code that assumes axis-aligned walls

| Module / function | What it assumes | Lift | If left as is |
|---|---|---|---|
| `core/plan.js` schema | walls are `[x,y,w,h,kind]` rects; openings have `axis 'h'\|'v'`; `hinge`, `swing`, `outside` are compass letters | S (additive) | no way to store an angled wall |
| `core/plan-edit.js` `buildModel`, `computeTypes`, `computeCores`, `buildWalls`, `buildOutline`, `buildRooms`, `traceLoops`, `narrowArea`, `derive` | the whole engine runs on a grid whose lines are rect coordinates. Bars are H/V with TMAX=30, segment ids are `seg:h\|v:…`, rooms are cell components | L. The grid stays; a mixed path is added | rooms, classes, outline and segments cannot exist for angled walls |
| `plan-edit.js` `planAddWall` | "smaller delta dropped" (pinned by `tests/plan-edit.test.mjs:146`) | M | — |
| `plan-edit.js` `fitWall`, `editModel`, `planMoveWall`, `cornerOpenings`, `slot`, `planAddOpening`, `updateOpening` | moves and slides run along an axis on the grid | M | — |
| `plan-edit.js` `sameSolid`, `isArchitectPlan`, `applyPlanState` (`validRect`, `axis === 'h'\|'v'`), `wallBounds` | rects only | S | saved plans with angled walls are rejected and fall back to the base plan |
| `core/plan-build.js` `readWalls` | diagonal, curved and polygon walls are an `error` (pinned by `tests/projects.test.mjs:71-76`) | S once the engine supports them | import cannot produce them |
| `core/plan-build.js` opening-in-wall check | rect overlap and adjacency | S | — |
| `core/geometry.js` `wallFaces` | `x1===x2` else horizontal; normals ±x/±y | S | snapping and regulations ignore angled faces |
| `core/geometry.js` `walkBlockers`, `wallsHitByItem` (`rectPoly(w)`), `pointInRect` uses | rects | S | — |
| `view2d/walls.js` | `G.rect` fill | S | angled walls invisible |
| `view2d/openings.js` `frame(o)`, `faceV` | `axis` h/v | S | — |
| `view2d/snapping.js` `buildRuns`, `snapWallLine`, `snapWallEnd`, `snapWallPoint` | horizontal/vertical runs only | M | no snapping to angled walls |
| `view2d/structure.js` `spanOf`, `rectOf`, `selectionHandles`, removed-walls diff | — | M | — |
| `view2d/structure-tools.js` `updateDraft` (axis lock), `centreFor`, `dragMoveWall`, `dragResizeWall` | — | M | — |
| `view2d/structure-overlay.js` `drawOpeningChain` | — | S | — |
| `view2d/dimensions.js` `facadeProfile`, `exteriorChains` (per compass side), `interiorDims` | — | M | wrong or missing chains |
| `ui/structure-inspector.js` (`seg.axis`, `o.axis`) and `ui/structure.js` `openingOffset` | — | S | — |
| `view3d/house.js` `makeGrid`, `buildShellSoups`, `buildFloorSoups`, `traceFootprint` | irregular grid; faces only on x/z planes | L | no 3D for angled walls |
| `view3d/openings.js` placement (`o.axis` lines 148-183, 416-435), lookup of the neighbouring wall | — | M | — |
| `view3d/walk.js` `rectBlocker` (cos 1), `defaultWalkStart` | — | S | walking through angled walls |
| `view3d/daylight/solver.js` `sceneInputFromPlan` (rects) | — | L | angled walls are absent from the light solve |
| `solver.js` `buildScene` | rect rasterising; `faceChart` per cell × 4 sides; `oAxisN`/`oPlane` apertures | L | — |
| `solver.js` `patchAt`, `chartFor`, `chartUV`, `transferLightmap` | dominant-axis normal | L | — |
| `regulations/geom.js` `largestInnerRect`, `polyEdges` (rectilinear), `narrowPassages`, `doorSwing`, `openingSides`, `clipHalf` | — | M | wrong room widths and clearances |
| `regulations/building.js` `roomSides` (skips non-axis edges, so mamad checks miss them), `rectObstacle(walls)`, `pointInRect` in setback code | — | M | — |
| `regulations/interior.js` (`rectObstacle(w)`, `rangesOverlap` by axis) | — | S | — |
| `carpentry/walls.js` `facesWithOpenings` (axis), `solidAt` | run frames are already general (`dir`) | S | — |
| `carpentry/runs.js:269` `rectsOverlap(PLAN.walls)` | — | S | — |
| `carpentry/checks.js:342,357-366` (axis, axis-aligned ray) | — | S | — |
| `import/walls.js` steps 3+ (H/V only; angled/curved pieces become `unsupported`) | — | M–L | owner's main complaint |
| `import/normalise.js` (rect re-cut after rotate/mirror) | — | M | — |
| `ui/import/wizard.js:755-821` | "redraw by hand" text | S | — |
| `collab/ops.js` `checkEntity('plan')` | shape-agnostic; only requires arrays | S | — |

### 1b. Code that assumes one floor

| Module / function | What it assumes | Lift | If left as is |
|---|---|---|---|
| `plan.js` `meta.floors: 1`; single `heights` | — | S | — |
| `plan-edit.js` | one set of arrays on `PLAN`; `BASE_PLAN` / `isArchitectPlan` / `planState` / `planDiff` are single-level; room and opening id allocation is per plan | L | no upper levels |
| `plan-edit.js` `setBasePlan` / `PLAN_KEYS` | `PLAN_KEYS` = keys of the built-in PLAN; `BUILTIN_KEY` / `projects.js:348` compare JSON | S, but a trap: new keys must never be added to House 98, and absent optional keys must be deleted on base switch | — |
| `plan-build.js` | floors are an `error` | S | — |
| `geometry.js` `spaceAt(x,y,plan=PLAN)`, `isIndoors`, `wallFaces` cache (PLAN only) | — | S. Pass a per-level plan view; cache with a WeakMap keyed by `walls` | — |
| `store.js` | items have no level; `spaceOf`; `ui` has no level; finishes cleanup reads `PLAN.rooms` only | M | items on upper floors impossible |
| `view2d/*` | `env.plan` is the plan; every item is drawn | M | — |
| `view3d/house.js` | floor at Y=0; roof slab and parapet over the whole footprint at H; plinth | L | no stacking |
| `view3d/items.js` `groundY`, elevation | — | S | — |
| `view3d/camera.js` presets, `environment.js` shadow bounds | — | S | — |
| `walk.js` | `EYE_HEIGHT` above Y=0; blockers of one plan | M | — |
| `daylight/solver.js` | one H per scene; roof closes every non-OUT column; one ground drop | L | upper floors unlit; lower floors see sky through the upper storey |
| `daylight/index.js` | one scene, one atlas | M | — |
| `regulations/*` | `plan.rooms` and `plan.walls` of one level; coverage = one footprint | M | — |
| `carpentry/*` | run → `roomId` and walls of `PLAN` | S | — |
| `finishes` | keyed by `spaceId` | none if room ids are unique across levels | — |
| `import` | one page = one plan; several drawings → pick one | M | — |
| `projects.js` | record shape | none (plan-shaped `basePlan`) | — |
| `collab` | single `plan` key | none (whole plan guarded); presence needs `level` | — |

**Naming collision:** `view2d/floors.js` means room floor finishes, and item `placement: 'floor'` is also taken. Use **level** in code (`levels`, `level`, `L0`/`L1`) and "floor/storey" only in UI text.

---

## 2. Target data model

### Decision: keep rects, add a separate `slants` array (not convert-on-load)
- **Identity is guaranteed.** With no slants, every code path is literally today's code, so tests, saved designs, `planStateKey` and the collab docs stay byte-identical.
- **Old consumers degrade safely.** Code that reads `plan.walls` keeps working; it simply does not see slants. Mixing a new shape into `walls` would make about 25 consumers silently compute nonsense with `w.x`/`w.w`.
- **Safety while stages land.** Slants stay behind a feature flag until every consumer is ported.
- **Why not convert on load.** Converting every rect to a centre-line graph would rewrite the 1370-line engine, change segment and rect ids, and break exactness on House 98. That is high risk for no user value.

### Plan JSON
`schema` is written only when needed; absent means 1. `L0` (ground) stays in the top-level fields, so no migration is needed.

```js
{
  schema: 2,
  meta: { …, floors: 2 },                          // derived: 1 + levels.length
  heights: { ceiling, slab, parapet, floorAboveGround, doorDefault },   // L0, unchanged
  bounds, walls, wallOutline, openings, rooms, outdoorAreas, site, assumptions,   // L0, unchanged shapes
  slants: [ { id: 's01', x1, y1, x2, y2, t: 10, kind: 'interior'|'exterior'|'mamad', cls?,   // centre line (0.1 cm precision)
              poly: [[x, y], …] } ],               // derived: mitred / joined footprint (stored like rooms are)
  stairs: [ /* stairs that start on L0, see below */ ],
  levels: [ {                                      // upper levels, bottom-up; key absent when none
      id: 'L1', name: 'First floor', nameHe: 'קומה א׳',
      elevation: 300,                              // cm, finished floor above L0 finished floor
      heights: { ceiling: 280, slab: 20, parapet: 40 },   // slab = the slab under this level's floor
      walls, wallOutline, openings, rooms, slants?, stairs?,
      voids: [ { id: 'v1', polygon: [[x, y]…], stair: 'st1' | null, railing: true } ],
      outdoorAreas: []                             // balconies / roof terraces (later; slab only)
  } ]
}
```

### Opening in a slant
Openings in rect walls are unchanged.
```js
{ id, kind, style, width, height, sill, wall: 's01', axis: 'a',
  at: 438,                                         // cm from (x1,y1) along the centre line to the opening centre
  hinge: 'a'|'b',                                  // jamb nearer the start / end
  swing: 'l'|'r',                                  // side relative to the direction x1→x2
  outside: 'l'|'r',
  // derived: cx, cy, angle (deg), t, x, y, w, h (AABB, culling only), rooms, exterior
}
```
- One helper, `openingFrame(o) → { cx, cy, ux, uy, nx, ny, L, T, angle }`, works for `h`, `v` and `a`.
- After G1, no consumer reads `o.x/w` as gap geometry.

### Stair (plan object with item-like pose)
```js
{ id: 'st1', to: 'L1', shape: 'straight'|'L'|'U', x, y, rot, width: 100,
  risers: 18, going: 29, landing?: { at: 9, size: 100 }, turn?: 'left'|'right' }
```
- The pose reuses `itemCorners` / `itemLocalToPlan`.
- The stair is stored on its bottom level. The void on the upper level is derived; a user can enlarge it but never shrink it below the headroom envelope.

### Other fields
- **Items:** `level: 'L1'` (absent = L0). The same field goes on carpentry runs.
- **Store UI:** `store.ui.level`, `store.ui.ghostBelow`.
- **Collab presence:** `p.level`.

### Ids
- **Slants:** `s01…`.
- **Levels:** `L1…`.
- **Stairs and voids:** `st<n>`, `v<n>`.
- **Room and opening ids** are allocated globally across levels (`room-<n>`, `door-new-<n>`), so `finish:<spaceId>` and collab keys need no change.
- **Segment ids:** unchanged on L0. Slant segments are `seg:a:<slantId>` (stable by slant id). On other levels the id is prefixed: `L1|seg:v:…`.

### Migration
- **None is needed.** Absent keys mean a schema-1 plan (one level, orthogonal).
- **Lazy upgrade.** `schema`, `slants`, `stairs` and `levels` appear only when the first one is created, and are deleted again when the last one is removed. A plan that returns to orthogonal and one level is byte-identical to schema 1, and `isArchitectPlan()` works again.
- **`setBasePlan`** must delete `OPTIONAL_KEYS = ['schema','slants','stairs','levels']` when they are absent from the new plan.
- **`planState()`** returns `{walls, openings, rooms}` plus each optional key only when present, so old history and collab keys are identical.
- **Files.** The project file stays `version: 1`. A plan with `schema: 2` opened in an older build loses only the new data. That window is short: static deploy, and collab clients reload on the protocol.

### Per-level view (main leverage for floors)
- `levelPlan(PLAN, id)` returns a PLAN-shaped object with a stable identity per level: that level's walls, openings, rooms, wallOutline, slants and stairs, plus the shared `meta`, `site`, `bounds`, and `heights` merged with the level's own.
- For `L0` it returns `PLAN` itself.
- Every pure function that already takes `plan = PLAN` works per level unchanged: `wallSegments`, `analysisOf` (already caches foreign plans by `walls` identity), `wallFaces`, `spaceAt`, `walkBlockers`, all regulations, every 2D renderer, and solver input.
- **Shared across levels:** `site`, `meta`, `outdoorAreas` (L0), `bounds` (the union).
- **Per level:** walls, openings, rooms, slants, stairs, voids, heights.
- **Roof:** for each level, its footprint minus the footprint of the level above.

---

## 3. Algorithms

### Angled walls

**Polygon kernel (A0)**
- Vendor Clipper 6.4.2 JS (Boost licence; integer, robust) as `vendor/clipper/clipper.mjs` with an `export default` shim.
- Wrap it in `src/core/polykernel.js` (integer millimetres): `union`, `difference`, `intersectArea`, `offset`, `faces(solids, bbox) → { outdoor, rooms:[{outer, holes}] }`, `slitJoin(outer, holes)` (the zero-width slit convention rooms already use), `normalise(poly)` (clockwise, start at min y then min x).
- Writing our own planar arrangement is possible, but its epsilon handling is the risk; Clipper removes it.

**Mixed derive (A1)**, only when a level has slants:
- **Solids** = wall rects ∪ rect openings ∪ slant polys ∪ slant-opening quads.
- **Rooms and outdoors.** Faces of the complement inside the bbox plus 100 cm: the face touching the bbox is outdoors; the bounded faces are rooms. Semantics are the same as the grid: openings are solid, so they separate rooms.
- **Room matching.** Match to previous rooms by Clipper overlap area, with the same tie rules, ids, labels (`interiorPoint` works on any polygon) and zones.
- **Rect segments.** Still from the grid. Extra grid lines come from slant poly vertices. Cells under slants are a new state `SLANT`: not free, not bar. `m.out` and `spaceOf` come from the polygon faces, not the grid flood.
- **Slant segments.** One segment per slant. Fields: `axis:'a'`, the centre line, `poly`, AABB `x,y,w,h`, `between: [leftSpace, rightSpace]` (sampled at several points along the faces), `freeEnds`.
- **Classification for arbitrary polygons.** Exterior if any face sample is in an outdoor face. Mamad if `poly ∩ mamad shell`. Otherwise thick or partition by `t` and `isNew`.
- **wallOutline** = union boundary edges, split at opening jambs. Diagonal `[x1,y1,x2,y2]` entries are allowed.

**Joins and mitres (A0, `src/core/slant-geom.js`)**
- **Slant end meets slant end (L or multi-way):** intersect the offset lines. Use a mitre if its length is ≤ 3 t, otherwise a bevel. For three or more walls at a point, add the convex hull of all the offset intersections as a joint piece.
- **Slant end on a slant side (T):** extend to that wall's centre line; the union cleans it up.
- **Slant end on a rect:** extend to the rect's far face and clip with the rect's outer half-plane, so it never pokes out.
- **Rect end on a slant:** the rect stays a rect, stopping at the first corner that touches the slant's near face. A joint-fill triangle (hull of the rect end corners and their projections onto the slant centre line) is added to the slant's `poly`.
- **Free end:** square cap.

**Edit ops on slants (A2)**
- `addWall({…, angled: true})`. Without `angled` the old behaviour holds (test line 146). Within 0.5° of an axis, the wall becomes a rect (fast path).
- `moveWallSegment(seg:a, delta)` moves the wall perpendicular to itself, + towards the right normal. Attached slant ends slide along their own direction (line intersection). Attached rect ends stretch on the 5 cm grid, and the joint fill is recomputed.
- `resizeWallSegment(seg:a, {start, end})` works along the centre line. A new `rotateWallEnd(seg, end, {x, y})` drags one end point.
- Refusal rules are the same as today: they are evaluated on the mixed derive (min clear 60 via inward offset of each room by 30 with Clipper: an empty piece means too narrow), and locks follow the same policy table.
- **Openings:** `slot()` works along `at` with the 10 cm jamb measured on the shorter face after mitres. Doors default to the hinge nearer the wall end and swing into the smaller room.

**Hit-testing and snapping (A3)**
- `segmentAt` checks rects first, then `pointInPolygon(poly)`, then the nearest edge within `tol`.
- The draw tool:
  - snaps the angle to 15° steps (45° and 90° are stronger);
  - snaps parallel or perpendicular to any wall within 400 cm (guide line drawn);
  - extends lines from wall ends;
  - offers typed length and angle;
  - snaps the end to a wall face by ray–face intersection.
- `buildRuns` gains diagonal face runs, so items snap and rotate to angled faces (`faceRot` is already general).

**Dimensions (A3)**
- Each slant gets an aligned dimension along each face, offset outward, plus its angle to the nearest orthogonal wall or to north.
- Exterior chains project the slanted sides onto the side they mainly face and show their overall extent.
- `interiorDims` uses the oriented largest inner rectangle (see regulations).

**3D (A4)**
- New file `view3d/shell-poly.js` builds an extruded-polygon shell from the union boundary.
- Each boundary edge becomes a vertical quad with u = metres along the edge and v = height. Its material comes from the space on the free side, sampled at the edge midpoint plus 1 cm along the normal.
- Openings split their edges and add reveals, sill and lintel. The caps are triangulated with `THREE.ShapeUtils`.
- In mixed mode, floors and ceilings are triangulated from room polygons, and skirting and contact-shade strips run along the polygon edges.
- `house.js` keeps the grid path for levels without slants and calls `shell-poly` otherwise. Using the general builder for the whole level in mixed mode avoids seams between the two builders.
- Openings use the `openingFrame` matrix (rotation about Y).

**Daylight (A7)**
- **Is the patch model tied to axis-aligned faces? Yes.** `faceChart[cell*4+side]`, `chartFor` / `patchAt` use the dominant axis, and `chartUV` assumes u along x or z.
- **Approach:**
  - Rasterise slant polys with *supercover* (a cell is WALL if the overlap is > 10 % of the cell). This keeps rays watertight (4-connected) for 7 cm walls at any angle, at a cost of up to 2.5 cm of thickening.
  - Add a chart type `'d'` per slant face × region. Patches lie on the true face plane with the true normal, area and position. Ray origins are nudged along the normal until they reach a ROOM cell.
  - Store `slantOf[cell]` for hit mapping: a hit on a slant cell is projected onto the face plane, on the side the ray came from, giving a patch.
  - `chartFor`: if the normal is within 8° of a slant face normal and the point lies within 3 cm of that face, use the `'d'` chart.
  - `chartUV` and `transferLightmap` gain a `'d'` branch.
- **Cheap fallback (S):** rasterise slants for occlusion only and render angled faces with the region-average chart that `chartFor` already falls back to.

**Regulations (A5)**
- `largestInnerRect`: try each distinct edge direction of the polygon, rotate into that frame, rasterise at 5 cm, and take the maximal rectangle.
- `polyEdges` and `roomSides` work for any edge, with normals from the edge.
- `narrowPassages` uses an inward offset by w/2 (Clipper).
- `clearance` and `flood` use `fillPoly` on slant polys.
- `doorSwing` and `openingSides` use `openingFrame`.

**Carpentry (A5)**
- `wallSpanAt` already uses frames. Ported to `openingFrame`: `facesWithOpenings`, `solidAt` (polygon), `runs.js:269` (convexOverlap with polygons), and `checks.js` rays (ray against polygon edges).

**Walk (A5)**
- Each slant becomes a rotated box (`cx, cy, hw = len/2, hh = t/2, cos, sin`); the module already supports rotated boxes.
- Windows in slants get the same treatment.

**Import (A6)**
- In `walls.js` step 3, pair angled wall-pen lines of the same pen that are parallel (≤ 1°), overlap ≥ 60 % and are 7–40 cm apart. Each pair becomes a slant (centre line plus thickness).
- Extend slant ends to the nearest wall face within 1.5 t.
- Curves (PDF Béziers already flattened, DXF arcs and bulges): approximate as a polyline of slants. Tolerance: sagitta ≤ 2 cm, chord ≥ 30 cm, at least 3 pieces per 90°, joined by mitres, and tagged `chain: 'c<n>'` so they are selected together.
- Unpaired angled lines stay `unsupported`.
- `normalise` maps centre lines through rotate and mirror. Openings in angled walls: the gap between two collinear slants on the same line becomes `{wall, at}`.

### Floors

**Editing (F1, F2)**
- `plan-edit` keeps an active level (`setActiveLevel(id)`). Mutations derive and install into that level's arrays; one undo step covers the whole plan state including `levels`.
- New mutations, all tracked for collab intents: `addLevel({ copyExterior: true })` (copies exterior walls and their windows up, with elevation = below.elevation + ceiling + slab), `removeLevel`, `updateLevel`.
- **Policy on upper levels:** in a fixed plan, exterior walls are locked as on L0. "Outdoors" is anything outside the level's footprint; voids count as indoor, not room.
- **2D:**
  - `env.plan = levelPlan(PLAN, ui.level)`.
  - Items are filtered by `level`.
  - The ghost layer draws the level below: wall outline at 25 % and stairs.
  - The level switcher sits in the top bar ("Ground / First floor / + Add floor").
  - New items get the active level.

**Stairs (F4)**
- `core/stairs.js` is pure: flights, treads, landings for straight, L and U shapes; the walking line; the headroom envelope (a line 210 cm above the pitch line); the required void = the part of the footprint where the upper slab underside is less than 210 cm above the pitch line.
- Mutations go through `plan-edit` (`addStair`, `updateStair`, `removeStair`).
- Rules go in `regulations/stairs.js`: riser, going, 2R+T, width, headroom, railing at void edges.
- **The numbers must be sourced and cited like the existing rules; they are not verified here.** Commonly cited values to verify: riser ≤ 17.5 cm, going ≥ 26–28 cm, 2R+T ≈ 62–65 cm, width ≥ 80–90 cm, headroom ≥ 2.00–2.10 m, railing ≥ 1.05 m.

**Slabs, voids, 3D (F3)**
- Each level's shell is built by the existing grid builder at Y = elevation/100.
- The slab under level k is a prism of level k's footprint minus its voids (`prism(outline, holes, y0, y1)` exists).
- The roof of level k covers its footprint minus the footprint of level k+1, with a parapet.
- Railings are drawn around voids, except at the stair arrival.
- Cut-away: levels above the active one are hidden, and `setCutaway` is relative to the active level.
- Items get `Y += elevation`.

**Daylight across floors (F6)**
- One scene per level (`sceneInputFromPlan(plan, { level })`), each with its own atlas.
- In the lower scene, columns covered by upper storeys get a per-column `roofTop[c]`, so the upper massing blocks sky and sun.
- In the upper scene, `OUT` columns over lower roofs get a per-column ground height (`groundY[c]`, generalising today's garden −0.15 m vs slab −0.02 m).
- Voids are treated as a dark floor (upper) and a ceiling (lower). There is no light exchange through stairwells in this stage; that is stated as a limit.
- The active level is solved first; other levels in the background.

**Walk (F5)**
- The walker knows its current level, and `floorHeightAt(x, y)` interpolates along the stair's walking line.
- Reaching the top switches to the upper level; going below the bottom switches back.
- Blockers come from the current level only, plus stair side walls and void railings.

**Per-level features (F7)**
- Furniture: `level` field.
- Carpentry: `run.level`; the frame and walls come from `levelPlan`.
- Finishes: unchanged, because room ids are unique.
- Regulations: loop the levels and add `level` to each finding. Coverage and setbacks use the L0 footprint ∪ projections of the upper levels.

**Import per floor (F8)**
- A multi-page PDF or several drawings become levels, with the user assigning each to a level.
- Alignment:
  - Automatic: the best overlap of exterior outlines over translation within ±50 cm and rotations of 0/90/180/270, scored by Clipper intersection area.
  - Manual: two pairs of points, as the underlay already does.
- Stair symbols are proposed from runs of parallel, equally spaced lines inside a rectangle, else placed by hand.

**Collab**
- Keep the single guarded `plan` key; floors are inside it.
- Add the new mutations to `PLAN_CALLS` in `bridge.js`.
- Per-level keys (`level:<id>`) would allow conflict-free editing of different floors at once; defer that.

---

## 4. Staged plan

**Feature flags.** Add `src/core/features.js` with `{ angledWalls: false, levels: false }`. Only UI entry points check it, so each stage can ship while the feature is incomplete:
- `levels` is switched on after F3.
- `angledWalls` is switched on after A4 and A5.
- A7 can follow; until then the cheap daylight fallback applies.

### Test houses (use as shared fixtures in `tests/fixtures/houses.mjs`)

**"Wedge" (non-orthogonal)**, cm, one level:
- **Rects:**
  - North wall `[0,0,1000,20,'exterior']`.
  - West wall `[0,20,20,760,'exterior']`.
  - South wall `[0,780,600,20,'exterior']`.
  - Partition `[500,20,10,760,'interior']`.
- **Slants:**
  - `s01` exterior, centre (990,10)→(590,790), t 20 (≈117.2°, deliberately not a 15° step).
  - `s02` interior 45°, centre (25,300)→(300,25), t 10.
- **Openings:**
  - Window 120 in `s01` at `at` = half the length.
  - Door 80 in `s02` at its midpoint.
  - Door in the partition, y 350–430.
  - Entry door in the south wall, x 200–290.
- **Expect:**
  - 3 rooms: the NW triangle, the west room, and the east trapezoid with inner vertices ≈ (510,20), (973.6,20), (583.9,780), (510,780), ≈ 20.43 m².
  - Assert room areas against analytic polygons computed in the test: |Δ| < 1 cm².
  - `s01` is exterior and locked; `s02` is a partition.
  - Both openings have the right `rooms`, and the window has `outside: 'r'` or `'l'` as computed.
  - Union of solids = 1 outer ring.
- **Rotation-invariance test:** a 400×300 room rotated by 30° against the unrotated one gives equal room areas (< 1 cm²) and, under an overcast sky, mean floor illuminance within 10 %.

**"Duplex" (two storeys)**:
- **L0:**
  - Exterior 20 cm walls: `[0,0,1000,20]`, `[0,780,1000,20]`, `[0,20,20,760]`, `[980,20,20,760]`.
  - Partition `[500,20,10,760]` with a door at y 300–390.
  - Entry door south, x 200–300.
  - Window north, x 650–800 (sill 90, h 120).
  - Ceiling 280, slab 20.
- **Stair `st1`:** straight, footprint x 520–620, y 266–759, up towards the north; 18 risers × 16.67 cm, going 29, 2R+T = 62.3.
- **L1:**
  - Elevation 300, ceiling 280.
  - Same exterior walls.
  - Partition `[300,20,10,760]` with a door at y 100–190.
  - East window, y 300–420.
  - Void `v1` x 520–620, y 266–640.
- **Expect:**
  - 2 rooms per level.
  - L1 east room floor area = 670·760 − 100·374.
  - Headroom passes. A void shrunk to y 266–560 gives a headroom finding.
  - L1 floor mesh at Y = 3.00, with the slab hole.
  - The walker goes from (570,740) on L0 to (570,280) on L1, eye at 4.65 m.

### Stages

| # | Goal | Files | Tests | Out of scope | Depends on | Size |
|---|---|---|---|---|---|---|
| **G1** | Geometry seams with no behaviour change: `openingFrame`, `wallPolys(plan)`, `wallFaces` with general normals, WeakMap caches per plan object. Port every `o.axis` / `rectPoly(wall)` consumer to them. | `core/geometry.js`, `view2d/openings.js`, `view3d/openings.js`, `view3d/walk.js`, `regulations/geom.js`, `regulations/building.js` (`roomSides`), `carpentry/walls.js`, `carpentry/checks.js` | New `tests/geometry.test.mjs`: golden JSON of `wallFaces`, `walkBlockers`, all regulation findings and `chartFor` results for House 98, captured **before** editing and equal after. All suites green. | any new geometry | — | M |
| **G2** | Schema and persistence seams: `OPTIONAL_KEYS`; `setBasePlan` deletes absent keys; `planState` / `applyPlanState` / `isPlanData` / collab `checkEntity` / `buildPlan` pass optional keys through; lazy `schema`. | `plan-edit.js` (state functions only), `projects.js`, `collab/ops.js`, `plan-build.js` (pass-through only), `store.js` (item `level` normalise; `ui.level` default) | Round-trip of a hand-made schema-2 plan through store, project file and collab doc; `BUILTIN_KEY` unchanged; old fixtures identical. | deriving anything new | — | S |
| **A0** | Polygon kernel and slant joins (new files only). | `vendor/clipper/*`, `core/polykernel.js`, `core/slant-geom.js` | `tests/polykernel.test.mjs`: shadow equivalence (kernel rooms of House 98 = engine rooms, symmetric difference 0; exterior classification of every segment equal); mitre cases L / T / X / 3-way / 15° bevel / rect-end-on-slant joint fill; union of House 98 < 5 ms. | wiring into the engine | — | M |
| **F1** | Levels in the engine: `levelPlan`, active level, `addLevel` / `removeLevel` / `updateLevel`, global id allocation, per-level `planDiff` / undo; store `spaceOf` per level; `buildPlan` with `levels`. | `plan-edit.js`, `plan-build.js`, `store.js`, `collab/bridge.js` (`PLAN_CALLS`) | `tests/levels.test.mjs` (Duplex without stair); `collab.test` case with levels; `projects.test:76` updated (floors accepted). | UI, 3D, stairs | G2 | L |
| **F2** | 2D per level: switcher, ghost of the level below, item filter, structure tools on the active level. | `view2d/index.js`, `renderer.js`, new `view2d/levels.js`, `view2d/items.js`, `ui/topbar.js` / `statusbar.js`, `ui/structure.js`, css | Node test of the filters; `e2e.smoke` adds a floor, draws on it, switches back. | 3D | F1 | M |
| **F3** | 3D stacking: per-level shells, slabs with voids, roofs per uncovered footprint, cut-away per level, item Y offset, camera presets. Turn on `levels`. | `view3d/house.js`, `items.js`, `carpentry.js`, `camera.js`, `index.js`, `environment.js` | Headless build of Duplex: mesh names per level, Y bounds, slab hole area; House 98 vertex hash unchanged. | stairs | F1 | L |
| **F4** | Stairs and voids: geometry, mutations, 2D symbol, 3D mesh, railings, regulation rules. | new `core/stairs.js`, `plan-edit.js` (mutations), new `view2d/stairs.js`, new `view3d/stairs.js`, new `regulations/stairs.js` (+ registration in `index.js`) | Duplex risers / 2R+T / headroom pass and fail; L / U landing geometry; auto void. | winders, spiral | F3 | L |
| **F5** | Walk across floors. | `view3d/walk.js`, `view3d/index.js` | Node walker simulation up the Duplex stair; L0 blockers do not apply on L1. | — | F4 | M |
| **F6** | Daylight per level: `roofTop[c]`, `groundY[c]`, one scene and atlas per level, background solves. | `daylight/solver.js`, `daylight/index.js`, `engine.js` | House 98 numbers exactly unchanged; Duplex L1 > 0 lux; L0 sky view reduced by L1 massing. | light through stairwells | F3 | L |
| **F7** | Regulations, carpentry, rooms and checks UI per level. | `regulations/index.js`, `building.js`, `interior.js`, `carpentry/state.js`, `runs.js`, `ui/rooms.js`, `ui/checks.js` | House 98 findings identical; Duplex findings carry `level`. | — | F1 (can run after F3) | M |
| **F8** | Import per floor: pages / drawings → levels, alignment, stair proposals. | `ui/import/wizard.js`, `import/index.js`, `plan-build.js` | Two-page synthetic from Duplex (`dxf-writer`) → 2 levels aligned within 5 cm. | — | F1, F4 | M |
| **A1** | Mixed derive: plans with slants load; rooms, classes, outline and segments derived; `buildPlan` accepts non-orthogonal centre lines. | `plan-edit.js` (`derive` branch, state validation), new `core/slants.js` | `tests/slants.test.mjs` Wedge (rooms, classes, sides, round-trip); `projects.test:75` updated (diagonal accepted); all old suites green. | editing ops, UI | A0, G1, G2, F1 | L |
| **A2** | Slant editing: `addWall({ angled })`, move / resize / end-drag, openings in slants, `planDiff`, collab intents. | `core/slants.js`, `plan-edit.js` (dispatch) | Wedge edits: refusals (crossing exterior, < 60 cm clear), followers, undo; old line-146 test unchanged. | UI | A1 | L |
| **A3** | 2D: drawing, hit-test, handles, angle tool (15° snaps, parallel / perpendicular guides, length entry), aligned dimensions, inspector, dirty rectangles. | `view2d/walls.js`, `structure.js`, `structure-tools.js`, `structure-overlay.js`, `snapping.js`, `dimensions.js`, `ui/structure-inspector.js` | Node tests of the snapping functions; e2e draws a 45° wall. | 3D | A2, F2 (both touch `view2d`; sequence after F2) | L |
| **A4** | 3D shell for mixed levels, rotated openings, triangulated floors. | new `view3d/shell-poly.js`, `house.js` (hook), `openings.js` | Wedge mesh: watertight (each edge shared twice), materials by side; House 98 hash unchanged. | — | A1, F3 | L |
| **A5** | Regulations, carpentry and walk for slants. Turn on `angledWalls` (with the A7 fallback). | `regulations/geom.js`, `building.js`, `interior.js`, `carpentry/walls.js`, `runs.js`, `checks.js`, `walk.js` | Wedge: inner rect of the trapezoid, mamad sides, run along `s01`, walker blocked by `s01`. | — | A1 (after F5 / F7 for shared files) | M |
| **A6** | Import angled and curved walls → slants and chains. | `import/walls.js`, `normalise.js`, `openings.js`, `dxf.js`, `ui/import/wizard.js` | `import.test:181-190` and `import.dxf.test:229-233` change from "reported" to "converted" (centre line within 2 cm, curve sagitta ≤ 2 cm); orthogonal walls unchanged. | true arcs | A0 (detection), A1 (`buildPlan`) | M |
| **A7** | Exact daylight on angled faces (`'d'` charts). | `daylight/solver.js`, `daylight/index.js` | Rotation-invariance test; House 98 exact. | — | F6, A4 | L (fallback S) |

### Waves (parallel lanes avoid shared files)
1. G1 ∥ G2 ∥ A0
2. F1 ∥ A6 (detection part only, in `src/import`)
3. A1 ∥ F2
4. A2 ∥ F3
5. F4 ∥ A3
6. F5 ∥ A4
7. F6 ∥ F7 ∥ A6 (`buildPlan` / wizard part)
8. A5 ∥ F8
9. A7

### Order
- **G1 and G2 come before both features.** They are cheap and pin identity with golden tests.
- **Floors before angled walls in the core:**
  - They reuse every engine.
  - Two-storey private houses are common for this owner's market.
  - A1 should build slants per level from the start.
- **A0 runs from day one**, so the kernel risk is retired early.

Total ≈ 2 S + 7 M + 9 L sessions. Floors alone ≈ G + F1–F7 (about 9 sessions); angled walls ≈ A0–A6 (about 7).

---

## 5. Risks and honest limits

**Still not supported after all stages**
- True arcs: curves are polylines within 2 cm.
- Walls with varying thickness, non-vertical walls.
- Split levels and mezzanines inside a level (only full levels plus voids).
- Sloped roofs, attics, gables (flat roof and parapet only).
- Basements and light wells (negative elevation, ground interaction).
- Cantilevered balconies with railings (data hook only).
- Spiral stairs and winders, ramps.
- Light through stairwells between floors (F6).
- An opening across a wall junction, or in a joint fill.
- Editing a curved chain as an arc.
- Concurrent conflict-free editing of different floors in collab (one guarded `plan` key).

**Where regressions are most likely**
- `plan-edit.js` state functions (`applyPlanState`, `isArchitectPlan`, `planStateKey` identity → collab and history).
- `PLAN_KEYS` / `BUILTIN_KEY` JSON comparisons (`projects.js:348`).
- `house.js` and the daylight chart layout (`transferLightmap`, atlas size).
- The 2D dirty-rectangle repaint (needs the slant bbox).
- Any consumer still reading `o.x/o.w` as gap geometry. G1 must grep all 26 `axis` users listed in §1.
- Mitigation: the golden tests in G1, the shadow-equivalence tests in A0, and the "House 98 exactly unchanged" assertions in every stage.

**Performance**
- The mixed derive adds a Clipper union of about 100 solids per drag step (< 5 ms), and runs only on levels with slants.
- Daylight cost scales with the number of levels (≈ 2× visibility time for two storeys). It runs in the worker, active level first.

**If effort must be halved, cut in this order**
1. A7 (keep the region-average fallback).
2. F6 cross-level massing (solve each level as an independent house, roof on top).
3. F8 automatic alignment (manual two-point only) and stair-symbol detection.
4. L and U stairs (straight only).
5. Curved walls in import (A6 angled pairs only).
6. Aligned dimension chains for slants (length labels only).
7. 3D cut-away niceties.

**Do not cut:** G1, G2, A0, F1, A1, A2 — everything else depends on them.

### Critical files for implementation
- /home/user/Interior-Design-App/src/core/plan-edit.js
- /home/user/Interior-Design-App/src/core/geometry.js
- /home/user/Interior-Design-App/src/view3d/house.js
- /home/user/Interior-Design-App/src/view3d/daylight/solver.js
- /home/user/Interior-Design-App/src/import/walls.js
- Also: /home/user/Interior-Design-App/src/core/plan-build.js, /home/user/Interior-Design-App/src/core/store.js, /home/user/Interior-Design-App/src/view2d/structure-tools.js, /home/user/Interior-Design-App/src/regulations/geom.js, /home/user/Interior-Design-App/docs/CONTRACT.md (§7, §10, §11, §13 need updating per stage)
- Tests that assert today's limitation and must change in the stage that lifts it: /home/user/Interior-Design-App/tests/projects.test.mjs (71-76), /home/user/Interior-Design-App/tests/import.test.mjs (181-190), /home/user/Interior-Design-App/tests/import.dxf.test.mjs (229-233). /home/user/Interior-Design-App/tests/plan-edit.test.mjs:146 must stay green (a near-diagonal input is still snapped to an axis unless `angled: true`).
