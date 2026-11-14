# living-dining.js — research log

Date: 2026-11-13. Zone `indoor`, categories `living` and `dining`. 97 products, all `priceDate: '2026-11'`, prices incl. VAT in ILS.

## Retailers and how data was read

| Retailer | Products | Price | Dimensions |
|---|---|---|---|
| IKEA Israel (ikea.com/il/he) | 30 | `"price"` JSON embedded in each product page, cross-checked with category listing | "Measurements" tab of the product page (first width/length/depth/height values; hand-set for ranges, see caveats) |
| ACE (ace.co.il) | 28 | `offers.price` in the product page JSON-LD (the listing ItemList agrees) | Dimension line in the product description (`ר'/ע'/ג'` = w/d/h or labelled values) |
| Home Center (homecenter.co.il) | 24 | `offers.price` in the page JSON-LD ("special web price") | "מידות" block of the product page / description |
| Aminach (aminach.co.il, Shopify) | 9 | variant price from `/products/<handle>.js` (all colour variants share one price) | "מידות" paragraph on the product page |
| Hollandia (hollandia.co.il, Shopify) | 3 | variant price from `.js` for the named mattress size | "רוחב כללי / עומק / גובה הספה" paragraph on the product page |
| Fox Home (foxhome.co.il, Shopify) | 3 | variant price from `.js` | "מידות" in description |

No retailer exceeds 40 % (IKEA 31 %, ACE 29 %, Home Center 25 %).

## Method
Bulk scripts (curl with browser UA, 0.5-1 s apart) pulled category listings (IKEA HTML cards, ACE ItemList JSON-LD, Shopify `collections/<c>/products.json`), then every product page used was fetched individually for price, stock and dimensions. Colours are hex values estimated from the product name / colour variant, not sampled from photos. Only in-stock items (Home Center, ACE) were kept.

## Sizes close to the architect's brief
* Corner sofa with chaise ~290 cm: IKEA KIVIK corner 5-seat 297 x 257 (5,640), KIVIK 3-seat+chaise 280 x 163 (4,590), ACE POLY modular corner 264 x 173 (2,680), ACE MASON 260 cm sofa (2,853.5).
* Coffee table 160x70: closest real options are IKEA STOCKHOLM 180x59 (1,295) and Home Center SOLI 138x68.5 (1,032); no 160x70 table with all data was found.
* TV unit ~290: IKEA EKET 280 (1,965), IKEA/BESTA 240, ACE/Home Center 180-220 units.
* Dining table 180x90: IKEA VOXLÖV 180x90 (1,395), ACE ZISEL 180x90 (1,119.3), IKEA STOCKHOLM 2025 230x90, IKEA TJÄRKIL 235 (extends to 290 x 100).
* Counter stools (seat 62-66 cm) for the 280 cm island: IKEA SKOGSTA / BERGMUND, ACE MISHI (65), ACE SOL.

## Caveats
* `dims` of extendable tables are the closed size; open size is in the description. KIVIK / ÄPPLARYD-type sofas: `dims.d` is the chaise/corner depth where stated.
* Hollandia sofa-beds are priced per mattress size (140 chosen); other sizes and fabrics cost more or less. Dimensions = mattress width plus the stated arm allowance.
* ACE MASON and similar are sold in several colours/sizes under one SKU family; the recorded price is for the listed SKU only.
* ACE and Home Center prices change often (promotions); Home Center/ACE items were in stock on 2026-11-13.
* Sets/pairs (e.g. pairs of bar stools, nesting trios) are recorded as the item sold; nest count is in `params.nest`.
* Home Center "Rozan" corner sofa (Vitorio Divani, 3.00 x 1.90 m, 4,270) was dropped: page gives no height.

## Dropped / not used
* Hollandia power recliners and other sofa-beds: no dimensions on the page.
* Home Center: Livea sofas Rita / Ronit, Revadim sofa-beds (Dikla, Hadas, Yarden, Rakefet), many armchairs and chairs: missing height or depth, or out of stock. RIO ceramic table: depth missing. Poseidon etc.: no dims.
* ACE Milano / Ventura / Nicholas / 1804 TV unit: description truncated, dimensions incomplete.
* IKEA ÄPPLARYD chaise, SÖDERHAMN 4-seat corner and sofa-bed, POÄNG, GLOSTAD 2-seat: measurement block could not be parsed reliably.
* IKEA extras fetched but trimmed to stay under the 40 % share rule.

## Retailers that blocked or lacked data
BoConcept / Natuzzi / Dr. Gav (HTTP 403), Beitili / KARE Israel / Rosetto / Kastiel / Bitan / Sitstyle (unreachable through the proxy), Pay&Go and KSP (Cloudflare 403), ID Design ("coming soon"), Habitat (catalogue only, no prices), Tollmans / Urbanica / Pashut Yarok / Zuri (no relevant indoor furniture with prices), Zara Home IL (JS only, not pursued).


## Living & dining: indoor boutique pass, 14 Nov 2026
Added 63 products from 9 new suppliers: Habitat 12, KARE 15, Kado Home 9, Design4You 6, Home 26 1, Zilber 3, Shpitzer 3, Tollman's DOT 8, Beitili 6 (blocks marked `>>> <supplier>` in `living-dining.js`).
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
