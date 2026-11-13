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
