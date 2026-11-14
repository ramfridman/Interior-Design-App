# bedroom-office.js — research log

Date of research: 2026-11-13. 91 products, all prices in ILS incl. VAT, `priceDate: '2026-11'`.
Every product name, price, URL and dimension was read in this task from the retailer's own page or its JSON feed.

## Retailers used (count)

| Retailer | Products | How price / dimensions were read |
| --- | --- | --- |
| IKEA Israel (ikea.com/il/he) | 35 | Product page re-fetched live: `"price"` in embedded JSON, dimensions from the page's measurements block (width / depth / height; beds: width, length, headboard height). |
| ACE (ace.co.il) | 24 | Category pages (schema.org ItemList) for the list; each product page's schema.org `Product` JSON-LD for price + availability (InStock only); dimensions from the "מידות חיצוניות" text of the description. |
| Shilav (shilav.co.il, Shopify) | 9 | `/products.json` feed for price; dimensions from the "מידות" line in the product description (cots: outer size). |
| Home Center (homecenter.co.il, Shopify) | 9 | Collection `products.json` feeds; dimensions from the "מידות" line in the description. |
| Office Depot Israel (officedepot.co.il) | 8 | Category HTML listing for URLs; product page for the final price (`data-price-amount`, first price in the price box = current price) and the "מידות" bullet list. |
| Polyron (polyron.co.il, Shopify) | 3 | `/products.json`; headboard height from "גובה ראש: 110" in the spec. Price of the 160/200 variant (URL carries `?variant=`). |
| Simmons Israel (simmons.co.il, Shopify) | 2 | `/products.json` variant price (90/200, head-lift mechanism); headboard 110 cm and +10 cm length from the description. URL carries `?variant=`. |
| Aminach (aminach.co.il, Shopify) | 1 | `/products.json` variant price (140/200); headboard 95 cm from the description. URL carries `?variant=`. |

IKEA = 38 % of the file (limit 40 %). Price range 95 – 5,190 ₪ (budget ACE / IKEA to premium Simmons / Shilav).

## Dimension conventions
* Beds: `dims.w` = frame width, `d` = frame length, `h` = headboard height (as stated; where only the mattress size is
  given by the retailer — Polyron, Simmons, Aminach — w/d equal the mattress size, Simmons adds the stated 10 cm headboard to the length).
* Height-adjustable desks / chairs: `h` is the lowest (desks) or highest (chairs) stated height; the range is in the description.
* Wardrobes for the architect's niches: 160 cm — Dublin 160 (ACE), Dror 160 (ACE), Odem 160 (Shilav); 320 cm — Roi 240 (ACE) + an 80 cm unit, or two 160 cm units. Desks of 140 and 160 cm: IKEA, Office Depot, ACE.
* Colours are estimated from the product photo/name.

## Dropped (and why)
* Pashut Yarok (WooCommerce): only decking / WPC / artificial grass, no furniture.
* Tollmans, ID Design, Ivory: no online prices (showroom site / JS app / computers only). KSP: HTTP 403. Beitili, Dr. Gav, Bitan, Garden Emporium: unreachable.
* Fox Home: no relevant furniture. Kravitz: office/gaming chairs listed, but pages give no overall dimensions → dropped.
* Hollandia, Motsesim: prices read, but no overall dimensions on the pages (beds depend on size/fabric) → dropped.
* Simmons double beds (Bed 1500 / Frame 350 / Bed 2000): price depends on optional headboard package, base-only dimensions unclear → dropped.
* Office Depot chairs that list only seat width, ACE items without a stated height, Home Center sit-stand desk without a stated height → dropped.
* Mattresses: out of scope.
* Items that appeared out of stock (ACE `OutOfStock`, Home Center unavailable) were not used.

## Caveats
* Prices on Shopify stores vary by size / fabric; the recorded price is for the variant named in the product name (variant id in the URL).
* ACE prices are the site's current prices (some with odd decimals due to discounts).
* Wall-hung / modular items (PAX, KALLAX) are priced as the exact configuration named.

## Verification
Two random 12-product samples (one product from every retailer plus random ones) were re-fetched on 2026-11-13: all HTTP 200,
all recorded prices found on the page. All 8 Office Depot URLs re-checked separately (200, price present). `loadCatalog()` loads 91/91 products with no warnings.


## Bedroom, kids, office & storage: indoor boutique pass, 14 Nov 2026
Added 23 products from 8 suppliers: Habitat 5, KARE 3, Kado Home 1, Design4You 1, Home 26 4, Zilber 2, Shpitzer 4, Kkids 3 (blocks marked `>>> <supplier>` in `bedroom-office.js`).
Ids are prefixed by supplier (`habitat-`, `kare-`, `knob-`, `kado-`, `design4you-`, `home26-`, `zilber-`, `shpitzer-`, `tzemer-`, `kkids-`, `tollmans-`, `beitili-`). Evidence per supplier below (same table in docs/CATALOG-RESEARCH.md).

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


## Second pass (14 Nov 2026)
New blocks marked `>>> <supplier>-2 (second pass 2026-11-14)` in bedroom-office.js. Per-supplier evidence, ratings (none checked, no `top-rated`), exclusions and the lists of suppliers with no public price / blocked / still skipped are in docs/CATALOG-RESEARCH.md section "Second pass (14 Nov 2026)". Summary for this file: Zaga 6, Ubject 1, Kaza 5, Moka Home 2, Home 26 1 = 15 products.
Data origin: prices from each shop's own page (WooCommerce/Shopify store API values that equal the displayed price, Zaga/Daniel Light/Tollman's from the page text); sizes from labelled blocks on the page, or, for Kaza, from the size triple labelled depth x height x width by the site's own script; Ubject only where the unlabeled order does not matter.
