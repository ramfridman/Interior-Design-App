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


## Second pass (14 Nov 2026)
Indoor furniture, lighting, rugs and decor. Catalogue total before this pass 1,108, after 1,266 (+158; `loadCatalog()` loads with 0 warnings, 0 duplicate ids). New products: living-dining.js 123, bedroom-office.js 15, lighting-decor.js 20. Blocks are marked `>>> <supplier>-2 (second pass 2026-11-14)` in the three data files; ids are prefixed `zaga-`, `ubject-`, `kaza-`, `items-`, `daniel-`, `moka-`, `tollmans-` (tollmans.co.il), `home26-`. Every product page was opened in this session; 15 random new URLs were re-opened at the end and all showed the recorded price (HTTP 200).

### 1. Added (supplier, evidence, rating, count)
| Supplier | Count | What it is (own page, read 14 Nov 2026) | How price and size were obtained | Rating |
|---|---|---|---|---|
| Ubject (ubject.co.il) | 35 | "Founded 2014, the first online brand in Israel for home and office design"; "we specialise in importing unique furniture and accessories selected from the best designers in the world", Danish designers, showroom in Nordia (home page "Our Story"). Tagged `boutique`. This is the shop the owner meant by "Ubject" (written ŪBJECT on the site; domain ubject.co.il; search for the Hebrew spellings found nothing else). | WooCommerce store API price (= shown price). Sizes are written "123/78" with no axis labels and the order is NOT constant on the site (AMALFI "160-210/90" but GALLINA "100/190-280"), so only items whose size is order-independent were taken: square footprints (78/78), round (קוטר), and extending tables/benches where the extension range shows which number is the length. About 200 other Ubject items (sofas, chairs, consoles, "N/N + height") were skipped for this reason. | not checked |
| Zaga (zaga.co.il) | 26 | Furniture maker/importer "specialising since 1961 in dining sets", own factory in Bulgaria, 12 branches, online ZAGAMIX line (about-us). Not tagged boutique. | Page text "current price" (all items are on the Black Friday sale; tagged `sale-price`); store API agrees. Sizes are labelled (width / depth / length / height) in the "מידות" block. Only items with one price across variants and in stock. | not checked |
| Kaza (kaza.co.il) | 45 | Family furniture chain, six branches, "designer furniture at sane prices", original furniture made mostly in Europe (about page). Not tagged boutique (retail chain). | Price = `display_price` of the product's variations (shown sale price; only products with the same price in every colour and one size). Sizes: the page shows "94x85x280"; the site's own script (custom.js, `CreateProductDimentions`) labels the three numbers depth x height x width, and the rendered "מידות ומפרט טכני" tab was opened in a browser for two pages to confirm ("עומק כללי 94, גובה כללי 85, רוחב כללי 280"). Excluded: beds (labels give depth = bed width), a dining table and a coffee table whose labelled values are physically implausible (77x90x160, 60x75x60), mirrors and round tables without "קוטר" (shape not stated), corner sofas (chaise side unclear). | not checked (page footer shows a D&B "reliability seal", not a rating) |
| Daniel Light Design (danielightdesign.co.il) | 14 | "Handmade in the workshop of Daniel Light Design" (product page); own studio, brass lighting, showroom Moshav Omez. Tagged `boutique`. | Price from the page (store API agrees); sizes from the labelled "מידות ופרטים טכניים" tab of each page (this tab is where the first pass found nothing). Only single-size pendants with a published glass diameter and height (`h` = glass height + 60 cord convention). | not checked |
| Items Gallery (itemsgallery.co.il) | 15 | Tel Aviv flea-market furniture shop. Not tagged. Two items are described by the shop itself as replicas (tagged `replica`). | Store API price (simple products only). Sizes labelled in the short description (diameter / height, or width / depth / height). | not checked |
| Moka Home (moka-home.co.il) | 7 | Israeli online bed/sofa/furniture shop, "12-month warranty". Not tagged. | Shopify price (single variant price); sizes from the labelled "מפרט ומידות" block. | not checked |
| Tollman's (tollmans.co.il) | 15 | Same importer as Tollman's DOT ("since 1986", about page); tagged `boutique`. The first pass wrote "no prices": the showroom site does show "list price" and "price after discount" on its sale pages. | Price used = "price after discount" (page says to contact the shop to order; the discount period is not stated). Sizes "35X35X45H" / "D90X40H" (H = height, D = diameter); only square-footprint, round and chair items whose first two numbers are equal were taken because the W-D order is unlabeled. Items marked SOLD were skipped. | not checked |
| Home 26 (26home.co.il), Chanel Plus dressing table | 1 | (already in catalogue) | The page shows 1,199 as the price (store price); the description says "sale 1,550 instead of 1,990". The shown price 1,199 is used and the conflict is noted in the description. | not checked |

No product carries `top-rated`: no rating of 4.5+ from 100+ reviews was read this pass.

### 2. No public price: needs the owner's decision
* **Waxman (waxman.co.il)** (office / contract and design furniture importer, 424 products): every product has price 0 and the pages give no sizes. Examples: ROUND https://waxman.co.il/product/round/, SMITH https://waxman.co.il/product/smith/, COMO SOFA, CLEAVE, TWIN, LINGO (all /product/<name>/). Sizes: not published on the page.
* **Aqua Creations**: gallery lists USD prices only (foreign currency, not included). No Israeli shop price found.
* **Karney Tchelet** (Flos / Moooi): no shop domain could be reached and no shekel price was found.
* Vitra Physix / ACX at Habitat Israel: Habitat shows the price (Physix 3,650, ACX 2,380 to 2,650) but no size; the manufacturer's size sheet is on vitra.com, which blocks automated access (below), so they stay out. Recorded here so the owner can add sizes by hand.

### 3. Blocks automated access: the owner can add these by hand
Each site answers with a Cloudflare "Just a moment / security verification" page (robots.txt itself is behind the challenge) or an Akamai "Access Denied". One page per site was tried with the preinstalled headless browser, unmodified (no user-agent or header changes); it was refused, so I stopped: Golf & Co (golfco.co.il), Vardinon (vardinon.co.il), CWC (cwc.co.il), HouseIn (housein.co.il), Deco-Or (deco-or.co.il), Rugsil (rugsil.co.il), SHW (shw.co.il), Zara Home Israel (zarahome.com/il), H&M Home Israel (hm.com), Vitra (vitra.com, used for the Habitat chairs).

### 4. Still skipped (reason)
* **Studio Cheha (studiocheha.co.il)**: lamp sizes are two numbers only (e.g. 48*146), no depth; photos only, no drawing.
* **Etzmaleh (etzmaleh.co.il)**: most pages give only a width (or a bed width x length without height); outlet / display items carry branch-specific prices and mismatched slugs; no drawings.
* **Kidikids (kidikids.co.il)**: no overall sizes in the text; gallery is lifestyle photos only (checked one bed).
* **Rahitale (rahitale.co.il)**: made to order, sofa length / bed size chosen by the customer, no fixed dimensions.
* **HaNamal Online (nammalonline.co.il)**: sizes like "75*81*111" are unlabeled and the order differs between products (200*45*53 sideboard, 33*40*220, 26*100*100), no stated convention.
* **Habitat chairs without size (Physix, ACX)**: manufacturer sheet blocked (see 3).
* **Tollman's DOT unlabeled items (Glyph Alpha, Tray S, Kobe)**: not re-opened this pass; the first pass's reason stands. The same-owner tollmans.co.il items above were added where the order is not an issue.
* **Karney Tchelet, Kastiel, KualaStyle, Million Chairs**: domains tried did not respond (502 / no host) through the network proxy; nothing opened, nothing added.
* **Daniel Light Design** wall lights, chandeliers, ceiling fixtures: no single labelled width / total height, or a displayed chandelier discount differing from the stored price; only the pendants above were taken.
* Other Ubject, Kaza, Zaga, Items Gallery products not listed above: skipped for unlabeled axes, price ranges between variants, out of stock, or implausible published sizes; the catalogue is a selection, not the shops' full range.

### Schema notes
Sizes of extending tables are the closed size (open size in the description). Round tables use diameter as w and d. Pendant `h` follows the earlier shade + 60 cm convention. `boutique` is used only where a quoted own-page line says so (Ubject, Daniel Light Design, Tollman's); Kaza and Zaga are chains/manufacturers and are not tagged. No code was changed.

## Shop discovery (14 Nov 2026, low-cost pass)

Four shops the earlier passes could not reach. Discovery only; nothing was added to the catalogue.

| Shop | Official site | Reachable | Prices in ₪ | Sizes | Outcome |
|---|---|---|---|---|---|
| Karney Tchelet (lighting; distributor of FLOS, Moooi, Vibia and others) | karney.co.il (shop under /shop/) | yes | no — not shown on any page checked | some pages: shade height and diameter | cannot be added while every catalogue product must have a price; candidate for "price on request" if the owner wants such items |
| Kastiel | none found | — | — | — | a 2017 press article reports the high-end operation closing; current status unconfirmed |
| KualaStyle | none found | — | — | — | only an unverified promotional page; existence unverified |
| Million Chairs | million-kisot.co.il (from a directory listing, not confirmed by the shop) | no — HTTP 403 twice, stopped | — | — | blocks automated reading; add by hand with "Add your own product" |
