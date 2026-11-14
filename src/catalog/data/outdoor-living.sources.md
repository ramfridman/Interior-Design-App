# outdoor-living sources (researched 2026-11-13, priceDate 2026-11)

127 products, zone `outdoor`. Counts per retailer: ACE 48, Home Center 44, IKEA Israel 16, Sofer Avi 14, Traklin 4, Toys R Us Israel 1.
Categories: outdoor-furniture 50, bbq 31, pool-spa 14, shade 10, outdoor-storage 9, play 5, fencing 5, outdoor-lighting 3.
Price range: 71.92 to 14,999 ILS.

## How data was read
* **IKEA Israel** (ikea.com/il/he): category pages for outdoor furniture, lighting, organising and rugs gave the product URLs. Each product page gave the price (embedded `price`) and the "measurements" tab. Sets (e.g. table + 4 chairs) use the table dimensions.
* **Home Center** (homecenter.co.il, Shopify): `/collections/<c>/products.json` for price and description; full description via `/products/<handle>.js` for dimensions. URL = `/products/<handle>`. Dimensions come from the description or the title (pools, sails). Lounge sets use the main sofa dimensions, because dims are per set in the description.
* **ACE** (ace.co.il): category ItemList JSON-LD for SKUs, then each product page (JSON-LD, visible price block, description). Price rule: the visible `finalPrice` if shown, otherwise the regular (`oldPrice`) price, because the JSON-LD value for some items is a club-member price (-10 %). Dimensions from the description text.
* **Sofer Avi** (soferavi.co.il, WooCommerce Store API): `price` from the API, `regular_price` greater than `price` means tag `on-sale`; dimensions read from the product page "מידות" block (Weber, Napoleon, Ooni, Coleman).
* **Traklin** (traklin.co.il): JSON-LD Product/Offer price on each product page; dimensions from the page text.
* **Toys R Us Israel** (toysrus.co.il, Shopify products.json): one frame pool.

## Conventions / caveats
* Sets sold together (lounge sets, dining sets) are one product mapped to `sofa` or `table`; `description` states which piece the dimensions describe.
* Grills: dimensions are the lid-closed footprint (width includes folded side shelves in the open position where the retailer lists it); lid-open height noted in `description`.
* Trampolines: `h` = safety-net height stated by ACE (the page does not give an overall height). Shade sails: `h: 250` is an assumed hanging height (not a product dimension).
* Stockholm pergola `h: 306` is the maximum wall-fixing height stated (range 240-306).
* Prices on Home Center differ in-store vs online; online (Shopify) price is used.
* Colours (hex) are estimated from product names/photos, not measured.

## Dropped (and why)
* Home Center Palram Feria / Sierra / SanRemo pergolas, Skylight/Rubicon sheds, Keter Factor sheds, Keter Eden bench, Bestway trampolines: no verifiable height/overall dimension or conflicting dimensions on the page.
* HC / ACE parasols (Manuela, 4x4 professional, Hammock Mexico etc.): no total height on the page.
* HC/ACE bollards (Santorini, Sunlight): width/depth not stated.
* Sofer Avi Napoleon PRO285X, Coleman G53xxx, Traklin Australia Chef Everest: depth not given.
* Traklin Sauter BBQ5000, Caesar Rubicon 3, Apollo 4, Keter Granada shed: product URLs returned 404 on fetch.
* LINOMATIC rotary clothesline, composters, hose reels, bike racks, EV chargers: no height / inconsistent price or dimensions, so the `outdoor-utility` category is empty in this file (gap).
* KSP (403 for scripted requests; not bypassed), Decathlon IL, Ooni/Weber/Keter official sites (unreachable or not scriptable): not used.

## Added 14 Nov 2026: new-supplier pass (outdoor, BBQ, shade, furniture)

37 products from 5 suppliers not previously in the catalogue. Prices ILS as displayed, read 14 Nov 2026 (`priceDate` 2026-11); each URL was fetched and the price and dimensions checked on the product page. `boutique` = own-made / boutique supplier; `top-rated` only where a rating >= 4.5 from >= 100 reviews was read.

| Supplier | What it is (from its own pages) | Rating read 14 Nov 2026 | Products |
|---|---|---|---|
| Argaman4U (argaman4u.co.il) | Store for grills, outdoor kitchens, smokers, pizza ovens and garden accessories; showroom Rishon LeZion (home page text) | Zap client card: 41 reviews (40 positive, 1 negative), no average score shown, none in the last year. Not enough for `top-rated` | 13 (Weber 3, Broil King 1, Ooni, Gozney, Cozze, Cook King 2, Elementi, Amisragaz heater, Gusto and Amgazit outdoor kitchens) |
| Tollman's DOT (tollmansdot.co.il) | Chain of designer furniture stores selling international design brands for home, office and garden (home page; lists Kristalia, Magis, Gubi etc.); the indoor pass in this same session read its about page (importer and retailer of international design, since 1986). Tag `boutique`, as in the indoor pass | rating not checked | 13 (tables, chairs, bar stool, lounge chairs; product pages state "price includes VAT") |
| Rocking Chair (rockingchair.co.il) | "Furniture for home and garden from the importer to the consumer" (page title) | Google reviews widget on its home page: 4.8 from 430 reviews. Tagged `top-rated` | 7 (3 rattan lounge sets, 4 rocking / folding armchairs) |
| Canopia Israel (canopia.co.il) | Consumer shop of Palram's Canopia aluminium pergolas, "made in Israel" per product pages | product page shows 5.0 from 1 review only, so no rating recorded | 3 pergolas (Sierra 3 x 4.3, Sierra 3 x 6.2, Stockholm 3.4 x 5.2) |
| Aviv Hegia Carpentry (avivhegia.co.il) | Carpentry workshop selling made-to-measure and kit wooden furniture and garden products, pickup from Porat (page) | page shows 19 Google reviews, no average; rating not recorded. Tag `boutique` | 1 (Nimrod entrance bench) |

Method: Argaman4U via the WooCommerce store API for the list and each product page for price (JSON-LD "price") and the "technical information" dimensions; Tollman's DOT product pages (JSON-LD price, "Dimensions --> WxDxH cm" attribute); Rocking Chair via the WooCommerce store API plus product-page "Dimensions" blocks; Canopia Wix product pages (JSON-LD price, "Dimensions" block).

Caveats and decisions:
* VAT: Tollman's DOT pages say "price includes VAT". Argaman4U, Rocking Chair, Canopia and Aviv Hegia pages do not state the VAT basis; shown prices are used as displayed (consumer shops).
* Sale prices (regular price struck through on the page) are the recorded price and carry tag `on-sale`: Rocking Chair (all 7), Tollman's DOT (Ariana, Plana, Dublin S, Capri, Madagascar, Marais, Okinawa), Canopia Sierra 3 x 4.3.
* Sets (Rocking Chair lounge sets) are modelled as the main sofa, with the set contents and other dimensions in the description (same convention as the ACE sets). Price is the whole set.
* Canopia pergola heights are the published range at the wall connection (260-305 cm); the maximum is used. Stockholm uses 324 cm (range 256.5-324).
* Colours (hex) for Tollman's DOT are sampled from the product photo (median of the central, non-white pixels) and tagged `hex-estimated`; Argaman4U and Rocking Chair colours are estimates from the name and typical finish (stated in the description).
* Aviv Hegia: only the Nimrod bench has one fixed size; its other items are made to measure with a size-dependent price and were skipped. The price (302) is read from the page's JSON-LD Offer; the visible price block is script-rendered.
* Skipped: SCAB (scab.co.il, 144 products) - prices are "from" prices with variants and the size table is empty in the page text, so no dimensions; Rocking Chair hammock chairs (hanging height not published); Argaman4U Napoleon Legend 365 (depth not readable); Canopia Feria and Sanremo (no dimensions block in the text).
