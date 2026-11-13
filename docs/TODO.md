# TODO — E7 House Designer

Last updated: 13 Nov 2026. Published preview (version 8): https://claude.ai/artifact/8ZvK3RLvmdmFnunBS8Mi1R

## Done (published as version 3, 13 Nov 2026)
- [x] Exact plan of house 98 from the architect's drawings; 2D editor; 3D view; walk-through.
- [x] Catalogue of 850 real Israeli-market products with prices and shop links.
- [x] Regulations and best-practice checker with sources.
- [x] True sunlight by date and hour (solar ephemeris, true north), date picker, presets, play-the-day, true-shadows toggle.
- [x] Safe room doorway with both doors (2D and 3D).
- [x] Structure editing: walls, doors, windows, passages, with the four permission levels, changes list, undo, save / open.

## In progress
- [x] **Realistic interior daylight** — published in version 4 (13 Nov). Follow-ups: furniture does not block bounced light; low-sun brightness and glass transmittance of the direct beam are not physically matched; lamps are not light sources at night; add a daylight on / off and clear / overcast toggle in the UI.

## Done in version 8 (13 Nov 2026, night)
- [x] Carpentry 3D polish: studio light, corner pantry checked by eye, lift-off door detail, splashback / upstand, sliding doors follow the run split, phone layout of the 3D tab.
- [x] Carpentry on the plan: move / rotate islands with live clearances, no furniture handles on made-to-measure units, wider quotation dialog, Hebrew spec vocabulary in the Hebrew PDF (a native speaker should check the terms listed in the hand-over note below).
- [x] UX fixes: finishes drop onto the 3D view, tablet drawer scrim, wall Length field, the Bedroom 1 / 2 partition drags north with its doors, clearer removed-wall ghost.
- [x] Narrow phones: one mode button (Furnish / Structure / Carpentry).
- [x] Hosting build: `node dev/build-site.mjs` writes `dist/site` (robots.txt, noindex, security headers); booted locally under the production Content-Security-Policy without errors.

Hebrew terms to have checked by a native speaker: לבן בוהק, גרייג׳, קשמיר, ירוק מרווה, כחול נייבי, קלקטה, נירוסטה (worktop), ציר קליפס 110°, מגירת קופסה על מסילות טלסקופיות (שליפה מלאה), נשלף לפחי אשפה, ידית חריץ עליונה, מנגנון הרמה (סטיי-ליפט).

Small follow-ups noted: island stools do not travel with the island; overlap of an island with ordinary furniture is only a warning; studio light leaves the room backdrop dim; 3D finish-drop highlight and phone studio / open-fronts not checked by eye; at 320 px wide the File menu button is cut off.

## Next
- [x] **Stretched display on a phone** — fixed in version 6 (13 Nov): off-screen sheets made the page itself scrollable, so the app could slide up and out of view. The root and the app shell are now clipped and page scroll is reset; the top bar fits down to 360 px wide (at 320 px the File menu is still cut off).
- [x] **Carpentry in 3D** — published in version 7 (13 Nov): every unit is built in 3D from the same data as the drawings (fronts, handles, worktops with cut-outs, corner pantry in its true L shape); 3D tab in the carpentry workbench with section cut, Open fronts, fit warnings pinned on the units. Follow-ups: the interior is dim at some hours (add a neutral studio-light option for inspecting carpentry); splashbacks / upstands not modelled; lift-off doors look like hinged doors while closed; sliding wardrobe doors do not follow the run's door split; corner pantry shape checked by numeric tests only, not by eye; phone layout of the 3D tab unchecked.
- [ ] Touch gestures for the structure tools are untested on a real device.
- [ ] Performance check on a real graphics card (only a software renderer has been measured).
- [ ] Catalogue gaps: long linear pendants, fountains / bird baths, composite decking, concrete pavers, date palms, heat-pump water heaters, clotheslines / composters.
- [ ] Merge branch `ccr-70c095fe-io3e41` into the default branch (pull request).

## Later
- [ ] **Public hosting, invite-only** — Cloudflare Pages + Cloudflare Access, free subdomain, hidden from search engines. Full plan and the owner's decisions: `docs/HOSTING-PLAN.md`.
- [ ] Price refresh script for the catalogue (prices are a November 2026 snapshot).

## Later — requested 13 Nov 2026

### Import any 2D sketch and draw it exactly
Today the app is built around one plan file (`src/core/plan.js`) that was measured from the architect's vector PDF by hand-written extraction. Goal: anyone imports their own sketch and gets the same exact plan.
- [ ] *Vector sources (can be exact):* vector PDF and DXF import — detect scale, wall lines by line weight, openings from gaps, rooms by flood fill (the method used for house 98), then a review screen where the user confirms scale, walls, doors, windows and room names. DWG needs conversion to DXF first.
- [ ] *Images and scans (cannot be exact automatically):* guided tracing — the user sets the scale from one known dimension, the app proposes walls and openings, the user corrects them. Accuracy then depends on the image and on the user's check.
- [ ] *Engine limits to lift:* the plan engine currently assumes straight, right-angled walls on one floor. Angled or curved walls, several floors, stairs and split levels need engine work in the plan editor, 2D, 3D, daylight and regulations modules.
- [ ] Per-project site data instead of constants: location (for the sun), north, lot boundary, ceiling heights, drawing assumptions.
- Questions when we start: which file types matter most (PDF, DWG / DXF, photo)? Only orthogonal houses first? One floor first?

### Online version with saving, where several people work on the same project
Today a design lives in one browser (plus Save / Open file). Goal: sign in, projects saved online, invited people open and edit the same project.
- [ ] Backend: accounts and sign-in, project storage, invitations and roles (owner / editor / viewer), version history.
- [ ] Sync: either live editing together (changes appear for everyone within a second, presence indicators) or simpler shared saving with "someone else changed this" handling. Live editing is the bigger build.
- [ ] Hosting changes from static-only to static + a small backend. Fits the chosen host: Cloudflare Pages + Workers + a database (D1) and Durable Objects for live sessions; Supabase or Firebase are alternatives. Free tiers cover a small group; check limits on the day.
- [ ] Privacy and safety: access control per project, backups, export of all data, deleting a project.
- Supersedes the browser-only saving described in `docs/HOSTING-PLAN.md` section 2; the invite-only decision still applies.
- Questions when we start: must people edit at the same moment, or is taking turns enough? Sign-in by email code, Google, or both? How many people and projects?

## Carpentry studio — STARTED 13 Nov 2026 (owner: "important, must be done perfectly, a professional tool")

**Status 13 Nov: published in version 5.** Engine (128 tests), bespoke units / door operations / corner pantry / special requirements, market-rate estimate, carpenter directory (45), bilingual vector PDF (104 tests), Carpentry mode workspace and panels are all in.
Follow-ups: wider quotation dialog; island move / rotate in the plan; left-edge resize should follow the cursor; furniture resize handles still show on carpentry units in Furnish mode; colours / hardware names are English-only inside the Hebrew PDF; price book confidence is mostly low — tune it with real quotes.

Decisions: quotation PDF in **English and Hebrew** (chosen at export); **cost estimates** shown as sourced ranges; **carpenter directory sorted by distance from the house**.

Build order: (1) core engine `src/carpentry/` — runs, module library, fit, validation, take-off, estimate, dimensioned drawings, schedules [in progress, Opus]; (2) carpenter directory research and (3) Israeli price-book research [in progress, Sonnet]; (4) drawing / PDF kit: SVG preview + real vector PDF with embedded Hebrew font, bilingual document composer; (5) Carpentry mode UI: run editor on the plan, elevation editor, spec inspector, estimate panel, quotation preview + export, carpenter list; (6) integration, review, publish.

Added 13 Nov — **Bespoke ideas** (owner's example: a corner pantry with removable doors): door operations on any unit, tall corner pantry, free-form bespoke unit composer, and free-text special requirements that flow to drawings, schedules, the quotation form and the PDF [engine extension in progress].

Original request and scope notes:

Design all made-to-measure carpentry for the house and hand a carpenter a complete package to price.

**What the owner asked for**
1. Design full carpentry: the whole kitchen, closets / wardrobes, pantries, and other built-ins.
2. Export it with full dimensions and specification, to show a carpenter and get a full cost offer.
3. A list of professional Israeli carpenters to talk to.
4. A well-designed PDF for them, generated from the designed carpentry.

**Proposed scope (to confirm before building)**
- [ ] *Carpentry mode* next to Furnish and Structure: pick a wall or niche (the app already knows every wall length, window sill and door position) and compose a run of modules.
- [ ] *Module library* with real carpentry parameters: base / wall / tall kitchen units, island, appliance housings, corner solutions, pantry, wardrobe (hinged / sliding, internal layout: rails, shelves, drawers), bathroom vanity, laundry / utility, TV wall, entry closet, shelving. Per module: width / height / depth, carcass material and thickness, front material and finish, handles or handle-less, plinth, internal fittings, hardware grade (hinges, drawer runners), worktop material / thickness / edge, splashback, lighting.
- [ ] Automatic fit to the room: fillers, scribe panels, clearances for appliances and door swings, checks against the regulations / ergonomics module (aisle widths, work triangle, worktop heights).
- [ ] *Outputs*: dimensioned plan and wall elevations per run, section where needed, 3D views, unit schedule, materials and hardware schedule, appliance list, site notes, and the open questions a carpenter must answer.
- [ ] *Quotation PDF*: a designed, print-ready request-for-quotation document built from the above (cover, project facts, drawings, schedules, terms to quote). Also CSV / JSON export.
- [ ] *Carpenter directory*: researched list of real Israeli carpenters and kitchen studios (name, area served, speciality, website / contact as published). Only businesses whose details were read from their own published pages; no invented entries, no ratings.
- [ ] Optional: indicative budget range per run from published Israeli price guides, clearly marked as an estimate.

**Questions to settle when we start**
- PDF language: Hebrew, English, or both? (The app is English-only by the owner's choice; carpenters in Israel will usually prefer Hebrew.)
- Which rooms first: kitchen only, or kitchen + all wardrobes + pantry + bathrooms in one go?
- Carpenter search area: near Afikim / Jordan Valley and the north only, or nationwide?
- Should the existing generic kitchen and wardrobes from the architect's layout be converted into editable carpentry runs as the starting point?
- Preferred materials / brands to include by default (for example worktop and hardware brands common in Israel)?

## Working method (to stay inside the usage limit)
- Lead on the top model, with as few turns as possible.
- Complex engineering (engines, 3D, CAD interaction): Opus.
- Well-specified UI panels, tests, documents, PDF layout: Sonnet.
- Web research and data collection: Sonnet; simple link / price re-checks: Haiku.
- At most 2–3 agents at a time, narrow briefs, few and small screenshots, work written to disk early.
