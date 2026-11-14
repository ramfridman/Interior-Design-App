# Catalogue research guide (market-research team)

You build one data file of **real products sold in Israel today**, each with its real current price (₪), real
dimensions and the real product-page URL. The home-owner will click these links to buy — accuracy is everything.

Read first: `docs/CONTRACT.md` § 6 (schema + hard rules), `src/models/types.js` (closed list of model `type`s
with their `params`, and the `CATEGORIES` tree), `src/catalog/index.js` (`validateProduct`).

You own exactly two files: `src/catalog/data/<your-file>.js` (`export default [ … ]`) and
`src/catalog/data/<your-file>.sources.md`. Touch nothing else. No git commands.

## Hard rules
1. **Never invent or guess** a product, price, dimension or URL. Name, price and URL must be read from a page or API
   response you fetched in this task; dimensions from the same page or the manufacturer's official spec.
   Cannot verify a field → drop the product. A smaller, fully real catalogue beats a bigger, partly invented one.
2. URL = the direct https product page a shopper buys from. No search-result, comparison-site (Zap) or redirect links.
3. Price = what the shopper pays now, incl. VAT, in ILS (on sale → that price, plus tag `on-sale`). `priceDate: '2026-11'`.
4. Spread over **at least 5–6 Israeli retailers** and budget / mid / premium tiers; real variety of sizes, shapes,
   colours and styles. Do not let one store exceed ~40 % of your file.
5. `type` must be one of `MODEL_TYPES`; `params` only from that type's vocabulary plus the common ones
   (`color`, `color2`, `color3` as hex estimated from the product photo; `material`, `material2`, `style`).
6. ids: kebab-case, unique, prefixed by the retailer slug (e.g. `ikea-…`, `ace-…`).

## How to research (network goes through a proxy; all of these work here)
* `WebSearch` / `WebFetch` (load via ToolSearch `select:WebSearch,WebFetch`) — Hebrew queries work best.
* `curl -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" <url>`
* JavaScript-rendered shops: preinstalled Playwright (`require('playwright')`, `chromium.launch()`; it honours the
  proxy) — read the rendered DOM or `script[type="application/ld+json"]` (name, price, sku).
* Shop platforms often expose JSON: Shopify `/products/<handle>.js`, `/collections/<c>/products.json?limit=250`;
  WooCommerce `/wp-json/wc/store/products?per_page=100`; IKEA product pages embed price + measurements.
* **Work in bulk with scripts**, not page-by-page by hand: write a small Node/Python script that fetches a listing
  or JSON feed, extracts name / price / url / dimensions, and saves compact JSON to your own scratch folder
  `<scratchpad>/<your-file>/` (scratchpad = `/tmp/claude-0/-home-user-Interior-Design-App/92a78ed2-1f75-5293-a8bd-74074184bc03/scratchpad`).
  Only print short summaries to your console — never dump raw HTML into your context.
* Be polite: sequential requests, ~0.5–1 s apart, cache what you fetch. If a site blocks you (403 / captcha), move on
  to another retailer — never bypass protections.
* A previous, interrupted run left some raw material in the scratchpad root that you MAY mine (treat as untrusted
  hints and re-verify price + URL for anything you use): `ikea_data.json`, `ikea_all.txt`, `ikea/`, `ace_list.json`,
  `ace_list.txt`, `cache/` (raw HTML), `evidence/`, `kb/`, `outdoor/`, `garden/`.

## Finish
1. Validate: `node -e "import('./src/catalog/index.js').then(async c=>{const p=await c.loadCatalog();console.log(p.length)})"`
   prints warnings for rejected products — fix them; ids unique across the whole catalogue.
2. Re-fetch a random sample of 12 of your product URLs: each must return HTTP 200 and still show the recorded price.
3. `<your-file>.sources.md`: retailers used, how price / dimensions were read per retailer, date, what was dropped and
   why, caveats (e.g. price varies by fabric).
4. Final report (concise): product count per sub-category and per retailer, price range, sample re-verification
   result, retailers that blocked access.

## Gap-fill pass, 13 Nov 2026
Added 28 real products (catalogue 850 -> 878; no validation warnings, no duplicate ids). Details and URLs in `src/catalog/data/lighting-decor.sources.md` and `garden-landscape.sources.md`.

| Gap | Added | File |
|---|---|---|
| Long linear pendants | 8 (IKEA 3, LED Market 5) | lighting-decor.js |
| Fountains / water features | 7 (Aquarium King 6, Tropical Fish 1) | garden-landscape.js |
| Bird baths | 0 | - |
| WPC decking | 0 | - |
| Paving / stepping stones | 2 (Bialik Nurseries, natural stone; no concrete pavers found) | garden-landscape.js |
| Date and specimen palms | 1 (Phoenix roebelenii, published height 3 m) | garden-landscape.js |
| Heat-pump water heaters | 0 | - |
| Clothes racks / wall rack | 6 (IKEA 2, ACE 3, Home Center 1) | garden-landscape.js |
| Composters | 4 (Composter.co.il 2, gardensheds.co.il 2) | garden-landscape.js |

Could not be found with all required data: bird baths with price and size from an Israeli shop; WPC decking with a stated price unit and thickness (Carmel Floor UH100R lists no unit); concrete pavers sold online; large date palms with published trunk height and spread; heat-pump boilers with published dimensions (Mashav lists prices only, and the two Mashav sites disagree); rotary clotheslines with a height (Leifheit via Home Center external seller). Composters have no own subcategory, so they use `outdoor-storage` / `bins`.


## Indoor boutique / new-supplier pass, 14 Nov 2026
Added 126 real indoor products from 12 suppliers that were not in the catalogue (living-dining.js 63, bedroom-office.js 23, lighting-decor.js 40). Each product page was opened in this session; ids are unique and `loadCatalog()` loads them with no warnings. Details per file in the three `*.sources.md`.

| Supplier | Products | living-dining / bedroom-office / lighting-decor |
|---|---|---|
| Habitat Israel (habitatshop.co.il) | 26 | 12 / 5 / 9 |
| KARE Israel (kare.co.il) | 28 | 15 / 3 / 10 |
| StudioKnob (studioknob.com) | 9 | 0 / 0 / 9 |
| Kado Home (kadohome.co.il) | 10 | 9 / 1 / 0 |
| Design4You (design4you.co.il) | 7 | 6 / 1 / 0 |
| Home 26 (26home.co.il) | 5 | 1 / 4 / 0 |
| Zilber Furniture (zilberahit.co.il) | 5 | 3 / 2 / 0 |
| Shpitzer (shpitzer.co.il) | 7 | 3 / 4 / 0 |
| Tzemer Rugs (tzemer.co.il) | 8 | 0 / 0 / 8 |
| Kkids (kkids.co.il) | 3 | 0 / 3 / 0 |
| Tollman's DOT (tollmansdot.co.il) | 12 | 8 / 0 / 4 |
| Beitili (betili-shop.com) | 6 | 6 / 0 / 0 |

By category: sofas 14, armchairs 11, side tables 9, coffee tables 6, poufs/stools 2, TV units 3, sideboards 3, bookcases 2, dining chairs 10, dining tables 3, nightstands 5, dressers 5, beds 1, wardrobes 2, desks 2, consoles 2, cabinets 1, wall shelves 2, kids storage 3, pendants 7, table lamps 12, floor lamps 5, wall lights 2, rugs 12, mirrors 2.

| Supplier | What it is (from its own page, read 14 Nov 2026) | Rating | Price read from | Dimensions read from |
|---|---|---|---|---|
| Habitat Israel (habitatshop.co.il) | Online "HABITAT POP UP SHOP" selling Artek, Vitra, Muuto, Kartell, Normann Copenhagen etc. (design retailer of third-party design brands; founding date not on the page) | rating not checked | Shopify `products.json` variant price (= price on the page; `compare_at_price` present means sale, tagged `on-sale`) | `span.meta_size` ("מידה") on each product page |
| KARE Israel (kare.co.il) | Online shop of the KARE design brand; "KARE City Studio"; contact domain duke-gallery.com; the site's about page returned 404 so ownership is not stated on a page I could read | rating not checked | WooCommerce store API `prices.price` (price shown on the page; no product was flagged on sale although the banner says "Black Friday 30 % off sitewide", so the discount is probably applied at cart: not verified) | "Dimensions" block (Width / Depth / Height cm, or "H x W x D") on each page |
| StudioKnob (studioknob.com) | "Original-design studio, not an importer" since 2015, founders Adi Azar and Yotam Shifroni (about page) | rating not checked | price on the product page / category list | "גודל" block on each product page |
| Kado Home (kadohome.co.il) | "Plans, designs, manufactures, imports and furnishes every space", "Since 1995", exclusive imports (home page) | not shown on page; rating not checked | WooCommerce store API price | labelled "מידות" sentence in each description (checked product by product) |
| Design4You (design4you.co.il) | "Custom furniture from manufacturer to consumer" (page title) | not shown; rating not checked | WooCommerce store API price | labelled "מידות" sentence in each description |
| Home 26 (26home.co.il) | "Furniture store" with custom sizes/colours, some items "made in Israel" (home page) | page shows 9 individual 5-star Google review cards, no aggregate: rating not checked | WooCommerce store API price | labelled "מפרט / מידות" in each description |
| Zilber Furniture (zilberahit.co.il) | Furniture store in Karmiel, "over 40 years", "exclusive importer" (home page) | 4.5 from 11 reviews, Dapei Zahav (d.co.il) page of the Karmiel store, last review 12 Oct 2022, read 14 Nov 2026 (not >=100 reviews, so no `top-rated`) | WooCommerce store API price | labelled "מידות" in each description |
| Shpitzer (shpitzer.co.il) | "Home for furniture", showrooms in several cities, "since 1946" (home page); the page does not say whether it manufactures | rating not checked | WooCommerce store API price (shop amounts are whole shekels) | labelled "מידות" in each description |
| Tzemer Rugs (tzemer.co.il) | Family-run rug importer and designer, 8 branches, "50+ years" (home page) | rating not checked | WooCommerce store API price of single-size ("simple") rugs | single `מידה` attribute (length x width) and `אורך סיבים` (pile) |
| Kkids (kkids.co.il) | "Boutique shop importing quality brands" of European kids' room items (home page) | rating not checked | WooCommerce store API price | labelled "גודל" sentence in each description |
| Tollman's DOT (tollmansdot.co.il) | Online shop of Tollman's: Israeli importer and retailer of international design, "since 1986" (about page tollmans.co.il/about). The main tollmans.co.il showroom site shows no prices | rating not checked | product page, read with WebFetch (curl gets HTTP 403) | "X x Y x H" line on the product page (only products with unambiguous labels used) |
| Beitili (betili-shop.com) | "The leading chain for design and furniture", online shop (home page) | rating not checked (a third-party page snippet showed weak, old Dapei Zahav sub-scores; not opened, not recorded) | product page, read with WebFetch (promotion price valid until 15.11.26) | labelled length / depth / height rows on each page |

### Caveats for this pass
* Tag `boutique` = own-design studio or design-brand importer/boutique per its own page (Habitat, KARE, StudioKnob, Kado Home, Tollman's DOT, Kkids). Chains and manufacturers (Design4You, Home 26, Zilber, Shpitzer, Tzemer, Beitili) are not tagged. No supplier qualified for `top-rated` (no recorded rating of 4.5 or more from 100 or more reviews).
* Pendants: `h` = published shade height + 60 cm cord (same convention as before) wherever the page gives only the shade; Kado/KARE items quoting a total height use it as published.
* Rugs: Pappelina (Habitat) rugs are published as "H x W" (length x width) and no thickness, so 0.4 cm is a 3D placeholder; Tzemer `dims.h` = published pile length, 1 cm where none is given (Opal Talis).
* Sale prices are the price shown now, tagged `on-sale` where the page shows an old price. Beitili promotions end 15.11.26.
* Kado Home clearance items (Panda armchair, Bono, Miguel) say "no returns / no warranty" on the page.
* Kartell / Muuto / Vitra colours and materials are as stated on the Habitat page; hex colours are estimates from names.

### Dropped in this pass (indoor boutique)
* Prices but no usable dimensions: Karney Tchelet (Flos / Moooi lighting, listings show no price or size), Daniel Light Design (own brass lighting, price shown but size only in an image tab), SOHO Center / Studio Cheha lamps (two dimensions only), Etzmaleh and Kidikids kids' beds (only mattress or seat sizes), Rahitale (sofa length "by choice"), HaNamal Online (sizes written "75*81*111" without axis labels), Kaza (size codes unlabeled), Zilber Synergy / Maor (not verified), Home 26 Chanel Plus (store price 1,199 vs 1,550 in the text), Habitat Physix / ACX chairs (no size), Tollman's Glyph Alpha (unlabeled axes), Tray S (three sizes), Kobe (no size), KARE items whose Dimensions block is empty.
* No price: tollmans.co.il showroom site, Karney listings, Aqua Creations (USD gallery only).
* Not reachable or blocked: Zara Home Israel, H&M Home (403), Golf, Vardinon, CWC, HouseIn, Deco-Or, Rugsil, SHW (403), Kastiel, KualaStyle, Million Chairs, ID Design and several others (unreachable through the proxy).
* Mashbir (fashion), Urban Home (gadgets), HomeWorkshop (password page): not relevant.

Verification: 15 random new URLs re-fetched on 14 Nov 2026, all HTTP 200 with the recorded price on the page (Tollman's DOT and Beitili need WebFetch because curl is blocked or the pages were read that way; they were read in this session). Ratings: only Zilber has a read value (4.5 from 11 reviews); every other supplier is "rating not checked", so no product carries `top-rated`.

## New-supplier pass, outdoor / garden / kitchen / bathroom / finishes, 14 Nov 2026

Added 104 real products (outdoor-living 37, garden-landscape 9, kitchen-bath-appliances 32, finishes 26) from 13 suppliers that were not in the catalogue when the pass started. Catalogue before this pass 878; after it, with the parallel indoor pass included, 1,108 (60 retailers, no duplicate ids, no validation warnings from `loadCatalog()`). Details, URLs and per-supplier method are in the four `*.sources.md` files (sections dated 14 Nov 2026). Every product page was opened in this session; price (as displayed) and dimensions (as published) are on the page. Hex colours of finishes and some furniture are sampled from the product photo and tagged `hex-estimated`.

| Supplier | What it is (own page) | Rating (value, reviews, source, 14 Nov 2026) | Products | File(s) |
|---|---|---|---|---|
| Argaman4U | grills / outdoor kitchens / pizza ovens store, showroom Rishon LeZion | Zap client card: 41 reviews (40 positive, 1 negative), no average shown; no tag | 13 | outdoor-living |
| Tollman's DOT | chain of designer furniture stores, international design brands (about page read by the indoor pass: since 1986); `boutique` | not checked | 13 | outdoor-living |
| Rocking Chair | "home and garden furniture from the importer to the consumer" | Google widget on its home page: 4.8 from 430 reviews; `top-rated` | 7 | outdoor-living |
| Canopia Israel | Palram's consumer shop, aluminium pergolas, made in Israel | 5.0 from 1 review only, not recorded | 3 | outdoor-living |
| Aviv Hegia Carpentry | carpentry workshop, wooden kits for garden and home; `boutique` | 19 Google reviews shown, no average; not recorded | 1 | outdoor-living |
| Izraela | nursery in Kibbutz Gvat, importer of the Esschert garden brand | none on page | 5 | garden-landscape |
| Shiruzka | handmade concrete pots, one concrete artist, local production; `boutique` | none on page | 2 | garden-landscape |
| Camisa | wood / building-materials warehouse, decking and turf department | not checked | 2 | garden-landscape |
| Golan Westline | official importer of SMEG and White Westinghouse, "30 years" (Smeg item `boutique`) | not checked | 8 | kitchen-bath-appliances |
| Bath Boutique | importer of bathroom furniture and sanitary ware, 30+ years; listed as a boutique store on Easy; `boutique` | not checked (Zap lists 11 reviews, no aggregate; page not opened) | 11 | kitchen-bath-appliances |
| Merkaz HaOdafim | discount appliance store, Petah Tikva, 20 years | 5-star icons, "excellent", based on 75 reviews, no numeric average; no tag | 7 | kitchen-bath-appliances |
| Bol Parket | parquet / cladding / lighted-mirror showroom, Petah Tikva (Shopify); prices include VAT per its FAQ | product pages show 5.0 from 202 Google reviews; `top-rated` | 26 (20 finishes, 6 mirrors) | finishes, kitchen-bath-appliances |
| Porcelanita | ceramics, flooring and bathroom showroom, Ashkelon | not checked | 6 | finishes |

Counts by category: BBQ and outdoor kitchens 13 (outdoor-living / bbq), outdoor furniture 21, shade 3 (pergolas), planters 5, outdoor utility (bird baths) 2, surfaces 4 (decking, synthetic grass, basalt paving, large tile), kitchen appliances 15, bathroom 17 (vanities 2, toilets 2, basins 3, mirrors 8, tubs 2), floors / wall finishes / tiles 24.

Earlier unsourced gaps:
* Bird baths: partly filled (2 small dishes from Izraela, 125 and 260; no pedestal baths found).
* Composite (WPC) decking: filled with one product (Camisa, per m2 with thickness and board size stated). Other Camisa deck pages show a price with no unit.
* Concrete pavers: still unsourced (only natural-stone and large-format porcelain paving found: Porcelanita basalt crazy paving 325 per m2).
* Heat-pump water heaters: still unsourced (guides and promotions only, no priced product page with dimensions found).
* Date palms: not retried. Rotary clotheslines: Leifheit pages found via search show diameter and arms but no height, so still unsourced.

Skipped, and why: SCAB (scab.co.il, 144 garden furniture / outdoor kitchen products; "from" prices with variants and no dimensions in the page text); Kolbogan synthetic grass (every page "out of stock"); Hezibank, Alony, Hamat, Negev (no prices on product pages or ex-VAT PDF price lists); Tambour and Nirlat (no online prices); Porcelanita vanities and Bath Boutique width-range vanities (size-dependent prices); Aviv Hegia made-to-measure items; Smeg products without dimensions in the page text; Camisa deck pages with no price unit; hammock chairs (no overall hanging height).
Sites that blocked or throttled: Camisa returned a bot-check page for several minutes (resolved on retry); galor-online.co.il was behind a Cloudflare check; tollmansdot.co.il's WooCommerce API errors (product pages work); ambatshop.co.il returned 403.

Schema notes (no schema change made): finishes sold by the sheet or roll are converted to per m2 with the arithmetic in `description`; set prices (rattan lounge sets) are modelled as the main sofa and the description says so; surface products use placeholder `dims` of the standard 400 x 300 / 300 x 300 cm area, as earlier surfaces do; pergola `h` uses the maximum published wall-connection height. Retailer names must match exactly across passes (a case difference "Tollman's dot" vs "DOT" was fixed so the shop appears once).

Verification: 15 random new URLs re-fetched on 14 Nov 2026, all HTTP 200 and each still shows the recorded price.
