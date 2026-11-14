# Worktop-stone research: sources, gaps, price notes

Read on **2026-11-14**. Files: `stone-suppliers.js` (31 suppliers), `stones.js` (140 slab models + 6 quoted natural-stone statements).
Rules followed: every fact comes from a page read in this session (own site, or the d.co.il directory for businesses with no site of their own);
nothing from memory; sites that refused automated reading are listed as blocked, not worked around. Details change: confirm by phone before relying on them.

How the reading was done: `WebFetch` (a summarising reader), so Hebrew quotes and some values are as the reader returned them. Three Caesarstone product pages
returned text that looked like embedded instructions ("quote rules", "response format"); those were ignored and only product facts were used.

## Suppliers (own sites)

| id | Source pages read | What was taken |
|---|---|---|
| caesarstone-israel | caesarstone.co.il (home, /catalog/ product pages, /design-and-specification/, /concept_house_direct_sale/, mos.caesarstone.co.il, sitemap page) | 103 design names + URLs (sitemap page), finishes / sizes / thicknesses by material, two Concept House showrooms (Lehi 37 Bnei Brak; Globus Center Ashkelon). **38** product pages read in full. |
| nir-zvi-marble | nir-zvi.co.il/marble-pricing/, /marble-for-kitchen/ | Rehovot showroom, Ramla factory, services, per-metre price classes, 6 named granites. |
| segev-carmel-stone | segevltd.co.il (home, /shop/) | 3 showrooms, brands (Dekton, Caesar Stone, Atlas Plan, Sapienstone, Silestone, Infinity, Sensa). No slab models readable. |
| daniel-marble-haifa | dmarble.co.il (home, /דגמי-שיש/, brand pages, 44 model pages, FAQ, magazine) | Haifa showroom, services, 18 brands / 1,027 models, model pages (finish, thickness, size, swatch). |
| jan-marble-netivot | jan-marble.co.il (home, category pages) | Netivot showroom, brands, promotional running-metre prices. |
| agam-marble-rishon | a-marble.co.il (home, kitchen-in-the-centre page) | Rishon showroom, services, brands. |
| ravinsky-marble | ravinsky.co.il | Petah Tikva + Kiryat Gat showrooms, Stone Italiana exclusivity, Google 4.1 / 67 reviews (shown on its own page). |
| opal-stone-holon | opalstone.co.il | Holon showroom, 600+ slabs, brands. |
| dan-marble-petah-tikva | dan-marble.co.il | Petah Tikva + Jerusalem branches, AtlasPlan exclusive importer. |
| fervital-granite | fervital1.co.il | Four showrooms, Antolini and inalco exclusivity, ~200 slab types in stock. |
| polostone-zippori | polostone.co.il (home, slab category pages 1-2, 2 product pages) | Manufacturer in Zippori industrial zone; 48 model names + URLs; own-storage swatch images. |

## Suppliers (directory only, `ownSite: false`, `listingOnly: true`)

All from d.co.il "marble for sale" listings (Haifa & Krayot list `h-c48670-e2-p0-l0`; North list `h-c48670-e10-p0/p20/p40-l0`) plus the single business page for Shesh Asadi (`/80034787/48670/`).
Fields shown are only what the listing showed (name, town, phone, sometimes street). Ratings were recorded only where the listing showed one:
Shesh Asadi 4.7 (3 reviews), Marble Center Check Post 4.8 (33), A. Aviv 4.7 (31), HaMumchim 4.1 (17). Asadi's phone is a Zap "virtual forwarding number" per the directory.
Coordinates for these are **town centres** (`coordsNote: 'town-centre'`), not the business address.
Regional coverage: Haifa/Kiryat Bialik/Kiryat Ata, Karmiel, Tamra, Nazareth area, Safed, Kiryat Shmona, Hazor HaGlilit, one in Beit She'an (Jordan Valley).

## Not included, and why

- **Blocked:** `marble-hamifraz.co.il` (Shesh HaMifraz, Haifa) returned HTTP 403 to the reader - not retried, not worked around. Seen only as a search-result title.
- **Cosentino Israel (Dekton, Silestone, Sensa):** `cosentino.com/il/` and `/he-il/` returned a 307 redirect with no body to the reader. No Israeli importer/distributor could be confirmed from pages read, so no "Cosentino Israel" supplier entry. Dekton and Sensa are therefore represented only through Daniel Marble's pages (it says it is an authorised Dekton fabricator and that the manufacturer warranty follows "the official importer's terms").
- **Neolith, Lapitec:** searches found no Israeli distributor or showroom; not included. (Nir Zvi's menu names Neolith, Laminam, Dekton, Florim, but no model list could be read.)
- **Laminam / Infinity / Ascale / Atlas Plan / ABK / Florim / Level / Novo Corso / Primo Top / DK Stone / Terra / Silestone / Caesar Porcelain:** sold by Daniel Marble (brand pages list counts only, 15 of 18 brand pages not opened), Jan Marble (396-model catalogue; first 40 names read: Ascale and Atlas Plan with codes), Opal Stone, Agam, Dan Marble. Model lists were not read in full, so these brands have **no stone records** (except 1 Ascale and 3 Caesarstone-porcelain entries that carry a price at Jan Marble).
- **Laminam Israel Ltd / Nyga / Fervital's Antolini and inalco catalogues, Sapienstone, Dan Marble's Atlas Plan list, Ravinsky catalogue:** search snippets or home pages only; no model pages read.
- **Caesarstone:** 103 designs are listed (name + URL) on the sitemap page; only the 38 whose pages were read are in `stones.js`. `3141 Egg Shell` returned 404 at the slug given; `4120 Raven` was dropped because the summary returned could not be matched to it with certainty. The where-to-buy store locator is JavaScript and unreadable, so there is no list of Caesarstone resellers. A plain `curl` of a product page returned 403, so no Caesarstone images were downloaded.
- **Tiberias / Jordan Valley / Afula:** no business with its own site was found; the only listing in the Jordan Valley is Shesh 2000 Asaad & Sons (Beit She'an, phone only). Shesh Asadi names Tiberias, Karmiel, Nazareth, Shefa-Amr and Kiryat Ata as service areas. Price pages from `aven-s.co.il` ("kitchen stone in Afula / Karmiel") appeared in search results but were not opened.
- **d.co.il entries left out:** ceramics, plumbing and tombstone businesses that appear in the marble category (Stern Ceramics, Maestro Ceramics, Sayegh & Sons, Haifa plumbing centre, Y.A.A. monuments); businesses in the Triangle / Wadi Ara and a few far from the region where the town could not be placed with certainty (Tamrat, Basma, Wadi al-Hamam, Kafr Qara, Baqa, Jatt, Hadera, Hosen, Migdim, Ma'ar).
- **Ratings:** Jan Marble shows "5.0 on Google" with no count, Daniel Marble shows three 5-star reviews without an aggregate; neither is recorded as a rating.

## Stone data: what each record holds and where it came from

| Group | n | Source | Notes |
|---|---|---|---|
| Dekton (Daniel Marble) | 19 | model pages `dmarble.co.il/דגמי-שיש/שיש-דקטון-דגם-<name>/` | 78 Dekton names listed on the brand page; 19 model pages read. Finish, thickness(es), slab size from each page. Site-wide: thickness 4/8/12/20/30 mm, finishes matte/glossy/velvet. Price: "set at a showroom consultation, includes measurement, fabrication and installation". Mapped to `material: 'porcelain'` (the app's "sintered porcelain (Dekton-type)"). |
| Natural stone (Daniel Marble, Eliahu Hasson Natural) | 19 | model pages | 96 names listed; 19 read: marble (Statuario, Arabescato, Portoro, Calacatta Viola, Bianco Laza), quartzite (Bianco Nuvolato, Tek Wood, Wood Stone), granite, onyx, travertine, "Quarzo Bianco" (page says natural quartz; mapped to `quartzite`). Pages give finish and slab size, **no thickness**. |
| Sensa (Daniel Marble) | 6 | model pages | Finish names are Sensa's own (Mirage, Leather, Caresse). No thickness or size. |
| Caesarstone Israel | 38 | product pages | Collection (Classico, Veins, Supernatural, ICON, Metropolitan, Basic, Porcelain), finish, thickness, slab size (standard 320x160 or jumbo 327x164 for quartz/Fusion; 320x160 for porcelain, 12 mm), colour/style text, care notes. ICON "Fusion" is mapped to `quartz`. No price or price group appears on any product page. |
| PoloStone | 48 | slab category pages 1-2 + 2 product pages | Collection, finish, per-model size/thickness are **not** on the model pages; category filter shows size 1620/3240 and thickness 12 for all 54 results and finishes Natural/Touch/Silk/Lux across the range, recorded as range-level. |
| Jan Marble | 4 | home + category pages | Only the models that carry a published promotional price. |
| Nir Zvi | 6 | /marble-for-kitchen/ | Named granites; page-level price class only. |

Colour (`hex`): **87 from swatches, 53 from names.**
- *swatch*: images from the supplier's own site (Daniel Marble `wp-content/uploads/dm-catalog/...`; PoloStone `storage.googleapis.com/polostone/2024/09/<NAME>-scaled.jpg`) were downloaded into a scratchpad folder (not in the repo) and the median colour of the slab area taken; `veinHex` is the mean of the 4 % of pixels that differ most in lightness (only kept when pattern is veined/terrazzo and the spread is visible). The Daniel Marble natural-stone images are showroom photographs, so a slab crop was chosen by eye per image. The PoloStone swatch URL pattern was read on two product pages (Calacatta Borghini, Beton Dark) and applied to the other names; 43 of 48 downloaded (HTTP 200), 5 returned 403 and use name-estimated colours. Dekton Edora's image has a transparent background; the centre of the slab was sampled.
- *name*: estimated from the published colour wording (all 38 Caesarstone, 5 PoloStone, 10 priced Jan Marble / Nir Zvi entries). Treat as indicative.
`pattern` for PoloStone, Jan Marble and Nir Zvi is guessed from the model name only (`patternFrom: 'name'`).

## What Israeli suppliers say about natural stone as a worktop (quoted, `NATURAL_STONE_STATEMENTS`)

- Daniel Marble FAQ: natural stone is "עמידה לחום ולשריטות, וצריכה איטום" - heat- and scratch-resistant, "and requires sealing". (https://dmarble.co.il/שאלות-ותשובות/)
- Daniel Marble "How to choose kitchen stone": onyx "אינו מתאים לשימוש יומיומי ולמי שמבלה זמן רב במטבח" - not suitable for daily use; and "you will have to choose natural granite or porcelain granite, known for heat resistance" if hot pans go straight on the worktop.
- Ravinsky: "שיש טבעי מעניק מראה יוקרתי שמתאים למי שמוכן להקפיד על תחזוקה" - natural marble gives a luxurious look suited to someone willing to take care of upkeep.
- Nir Zvi (marble-for-kitchen): says white natural-stone surfaces "אינם סופגים כלל" (do not absorb at all; soap and water are enough) and that natural granite and natural quartz "need no maintenance". The page says nothing about etching, acids or sealing for marble. This sits uneasily with Daniel Marble's "requires sealing"; both are quoted, neither is endorsed.
- Agam Marble: "very expensive stones that look good but are not suitable for an active kitchen" (stones not named; not marble-specific).
- No supplier page read used the words etching or acid for marble. Only Daniel Marble's model pages for Statuario and Calacatta Viola say "suitable for kitchen, bathroom and wall cladding"; the Arabescato, Portoro and Bianco Laza pages say "suitable for surfaces" only.

## Prices found (all as published; no price groups exist on any page read)

- Caesarstone, Dekton (Daniel Marble), PoloStone: **no price and no price group** published; Daniel Marble says quotes are given at the showroom.
- Jan Marble (home page, 24-hour promotional lineup; incl. VAT, measuring, delivery, installation): from **₪990 per running metre** for e.g. Ocianoston 901, Aisling White 903, Fume 580 (listed there by name/code), Desert Gray, Calacatta Borghini, Statuario Venato, Sandstone Gray, Lunaburst 904; from **₪1,190 per running metre** for Moon Black 630, Bahia 910 (Ascale), Chianca di Ostuni SE01, Nuovo Corso Chapeau de Gris. Category page repeats "from ₪1,190 per running metre, incl. VAT, measurement, delivery and installation" for Moon Black 630 and Bahia 910; other models "price by size".
- Nir Zvi `/marble-pricing/` (per running metre, 100/65 cm, material + measuring + fabrication + installation, sink not included, indicative): local marble 1,200-1,500; natural granite 1,300-2,800; natural quartz from 2,600; onyx from 2,500; Caesarstone 1,250-2,450; porcelain granite 1,250-2,650. The page does not say whether VAT is included.
- Nir Zvi `/marble-for-kitchen/` (illustrative): Classic from 1,250 per metre (granite and Caesarstone); Premium 2,500-6,000 (Italian marble and natural quartz); Rare 8,000+ (exotic quartzite and rare Italian marble); a heading on the same page says marble "starts at 1,200 per metre".

## Notes on the existing price book (`pricebook.js` not edited)

1. The Nir Zvi figures in the book are the ones above divided by 1.18 (marble-local 1,015-1,270 = 1,200-1,500 / 1.18; granite 1,100-2,375 = 1,300-2,800 / 1.18; porcelain 1,060-2,245 = 1,250-2,650 / 1.18). The page does not state its VAT status, so this is the book's own assumption (documented in its notes) - worth flagging in `confidence`.
2. Jan Marble's promotional ₪990 / ₪1,190 per metre incl. VAT (= 839 / 1,008 ex VAT) are **below** `worktop.porcelain.per-m` low (1,060): the book's porcelain range has no "promotional / entry" tier.
3. `worktop.marble-local` covers only local limestone-type "marble" (Hebron / Mitzpe / Atzmon names on Nir Zvi). Imported Italian marble, natural quartzite and onyx have no key; Nir Zvi prices them at roughly double.
4. `spec.js` `VOCAB.worktopMaterial` has no `marble`, `quartzite`, `onyx`, `travertine` (the data here uses them); `splashback` `same-as-worktop` has no stone-specific price.
5. No source read gives a sintered-stone fabrication surcharge, stone upstand / splashback per metre, waterfall end, or mitred edge as a number (the book already has hob/sink cut-outs for Dekton). Those keys below are therefore **left open** rather than filled with guesses.

### Proposed rate keys (ex-VAT = published incl.-VAT price / 1.18, rounded; unit = running metre `m`; all low confidence, single supplier)

| key | low | typical | high | source / derivation |
|---|---|---|---|---|
| `worktop.porcelain.promo.per-m` (entry price, supplier promotion; incl. measuring, delivery, install) | 839 | 839 | 1,008 | jan-marble.co.il home + category page: from 990 / from 1,190 incl. VAT, 2026-11-14; typical = lowest promo price (it is a "from" price) |
| `worktop.marble-italian.per-m` | 2,119 | 3,602 | 5,085 | nir-zvi.co.il/marble-for-kitchen/ Premium 2,500-6,000 incl.? (VAT status not stated); typical = midpoint 4,250 / 1.18 |
| `worktop.quartzite-natural.per-m` | 2,203 | 3,602 | 5,085 | marble-pricing "natural quartz from 2,600"; marble-for-kitchen Premium 2,500-6,000; "Rare" class 8,000+ (6,780+ ex VAT) for exotic quartzite |
| `worktop.onyx.per-m` | 2,119 | - | - | marble-pricing "onyx from 2,500" (a "from" price only) |
| `worktop.granite.per-m` (existing) | keep | | | page reads 1,300-2,800 (marble-pricing) and "Classic from 1,250" (marble-for-kitchen): consistent with the book |
| `worktop.quartz.per-m` (existing) | keep | | | Caesarstone 1,250-2,450 on Nir Zvi sits inside the book's 930-2,965 |
| `worktop.sintered.fab-surcharge`, `worktop.upstand.stone.per-m`, `worktop.waterfall-end`, `worktop.edge.mitred` | open | | | no number found on any page read; Daniel Marble and Caesarstone list edge profiles (mitre / thick edge, eased, shadowline, bullnose, double bird's beak ...) and edge thickness 20 to over 40 mm without prices |
| by brand price group (1-6) | open | | | none of the Israeli suppliers read publishes price groups; Caesarstone, Dekton and PoloStone give no prices |

## Open questions for a follow-up

- Cosentino Israel (Dekton / Silestone / Sensa importer) and Laminam Israel could not be read; a human could confirm importers and showrooms.
- Caesarstone's reseller list (JavaScript locator) and fabricator network for the north.
- Jan Marble / Daniel Marble full catalogues (Laminam, Infinity, Atlas Plan, Ascale, Florim ...) would add several hundred more models; the brand pages are readable, model pages were not opened.
- Tiberias, Afula and Jordan Valley businesses with their own sites: none found by search.
