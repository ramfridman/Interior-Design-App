# TODO — E7 House Designer

Last updated: 13 Nov 2026. Published preview: https://claude.ai/artifact/8ZvK3RLvmdmFnunBS8Mi1R

## Done (published as version 3, 13 Nov 2026)
- [x] Exact plan of house 98 from the architect's drawings; 2D editor; 3D view; walk-through.
- [x] Catalogue of 850 real Israeli-market products with prices and shop links.
- [x] Regulations and best-practice checker with sources.
- [x] True sunlight by date and hour (solar ephemeris, true north), date picker, presets, play-the-day, true-shadows toggle.
- [x] Safe room doorway with both doors (2D and 3D).
- [x] Structure editing: walls, doors, windows, passages, with the four permission levels, changes list, undo, save / open.

## Next
- [ ] Lead's UX review pass (known: finishes cannot be dropped onto the 3D view; tablet side panels have no scrim; wall length has no inspector field; the Bedroom 1 / Bedroom 2 partition cannot be dragged until a bedroom door is moved away from its end; the removed-wall ghost is faint in dark theme; touch gestures for structure tools untested).
- [ ] Performance check on a real graphics card (only a software renderer has been measured).
- [ ] Catalogue gaps: long linear pendants, fountains / bird baths, composite decking, concrete pavers, date palms, heat-pump water heaters, clotheslines / composters.
- [ ] Merge branch `ccr-70c095fe-io3e41` into the default branch (pull request).

## Later
- [ ] **Public hosting, invite-only** — Cloudflare Pages + Cloudflare Access, free subdomain, hidden from search engines. Full plan and the owner's decisions: `docs/HOSTING-PLAN.md`.
- [ ] Price refresh script for the catalogue (prices are a November 2026 snapshot).

## New feature (requested 13 Nov 2026): Carpentry studio

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
