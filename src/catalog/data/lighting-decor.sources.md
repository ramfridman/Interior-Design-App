# lighting-decor.js — research log

Date: 2026-11-13. Zone `indoor`, categories `lighting` and `decor`. 95 products, `priceDate: '2026-11'`, ILS incl. VAT.

## Retailers
| Retailer | Products | Price | Dimensions |
|---|---|---|---|
| IKEA Israel | 38 | `"price"` JSON embedded in each product page | "Measurements" tab of the page |
| ACE (ace.co.il) | 38 | category ItemList JSON-LD (same price shown on the page) | size in product title (rugs, mirrors, clocks, cushions, fans) or "מידות" lines in the description / spec table (lamps, planters) |
| Home Center | 9 | Shopify `products.json` (price = page JSON-LD) | size in product title / description |
| Aminach (Shopify) | 6 | variant price for the stated size from `products.json` | size is the variant name (200/290 etc.) |
| Home Style (Shopify) | 4 | variant price for the stated size | size in variant name / description |

IKEA = 40 % of the file; no other store above 40 %.

## Method
Bulk scripts (curl, browser UA, 0.5-1 s apart) pulled IKEA listings and product pages, ACE category ItemLists and product pages, Shopify `collections/<c>/products.json`. Only in-stock items kept. Colours are hex estimates from product names, not sampled from photos. Sample re-verification: 14 random products plus all Home Center / Aminach / Home Style items re-fetched, all HTTP 200 with the recorded price present.

## Caveats
* Curtains: IKEA / Home Style prices are per pair (2 panels) unless the description says single panel; `dims.w` = one panel.
* Pendant `h` = total drop: stated height where the page gives one, otherwise shade height + 60 cm (said in `description`). STOCKHOLM 2025 glass pendant (h 110) and MISTERHULT (h 100) use this rule.
* Plants: only FEJKA artificial plants (IKEA) have pot diameter and plant height on the page; overall spread `w`/`d` is estimated. No Israeli live-plant shop with usable data was found. Planters (ACE) are modelled with `plant: 'none'`.
* Aminach rug prices are per size variant (200x290 or 160x230 as named).
* Ceiling fans: only ACE Westinghouse Valeria and Longwood pages state a height (max drop from ceiling 36 / 38 cm); blade span from the stated 42".
* Prices on ACE / Home Center change often.

## Dropped / not used
* Home Center and ACE flush / pendant lamps (Nisko, Omega, Bright Light and most ACE lamps): no height or no size on the page. ACE Alexander 3 pendant, MAY floor lamp: one dimension missing. ACE fans (about 100 others): no height stated.
* IKEA BAVE track, VINDKAST, TVARHAND, ARSTID wall lamp: dimension missing. IKEA CYLINDER vase set: not parsed.
* Luce.co.il: AliExpress drop-shipping, no real dimensions. Zara Home, H&M, Golf, Vardinon, Naaman, KARE, Habitat, Tollman's, plant shops: blocked (403 / Cloudflare), unreachable, or no product JSON.
* Pruned to keep IKEA at 40 %: 21 verified IKEA items (e.g. DEJSA, FADO, SANELA, LINDBYN).

## Gap-filling pass (2026-11-13): fans, ceiling/floor/table/wall lights, linear pendants, live plants
Added 58 products (ids unique, validated with `loadCatalog`, no rejects). File now 153 products: IKEA 55 (36 %), ACE 50 (33 %), no other store above 15 %. Added: ceiling-fan 11, ceiling-light 10, floor-lamp 8, table-lamp 10, wall-light 6, pendant 2, plant 11. Price range of the additions 39-1999 ILS.

| Retailer | Added | Price | Dimensions |
|---|---|---|---|
| IKEA Israel | 17 | `"price"` JSON in the product page | "Measurements" tab (re-listed from category pages floor-lamps-10731, table-lamps-10732, wall-lights-20503, ceiling-lights-18750, pendants-18751, spotlights-20506) |
| ACE | 12 | category ItemList price, same price on page | "מידות" lines in the description block (own scan of all ACE table / wall / hanging / ceiling lamp pages; only those with explicit height + width/diameter kept) |
| Sofer Avi (soferavi.co.il, WooCommerce) | 6 | Woo Store API `prices.price` | blade span and "גובה מקס' מהתקרה" in the description spec |
| Bug (bug.co.il) | 5 | JSON-LD offer price | "מימדים" spec: span + drop ("גובה", "יורד מהתקרה", "מרחק תליה") |
| neta plants (netaplants.co.il, WooCommerce) | 6 | Store API variation price for the grower-pot variant of each size | page text "טווח גובה" per size (S/M/L/XL/XXL) |
| Plants4u (plants4u.co.il, WooCommerce) | 5 | variant price printed on the page ("10 ליטר (₪175)") | page text "גובה כ-N סנטימטר" per pot size |
| Fox Home (Shopify) | 4 | `products.json` variant price | "מידות: רוחב ... גובה ..." in the product page |
| Home Center (Shopify) | 3 | `products.json` price (= JSON-LD) | description / title (ORA 50x4.5, Sapir 142 + shade 32, LED lamp 14x31) |

Verification: all 58 new URLs re-fetched on 2026-11-13, all HTTP 200 with the recorded price present in the HTML (6 initial timeouts / one 403 on IKEA and Fox pages passed on retry).

### Caveats
* Fans: `dims.w = d =` blade span, `h` = the drop the page states ("max height from ceiling" / "total height"). Bug Midea 46 ("יורד מהתקרה כ-36") and Gold Line 56 ("גובה: 36") state a single figure that is taken as the drop. Talia fans do not state the blade count, so `blades` is omitted. Colours are estimated from names/specs.
* Plants: heights are as stated by the shop (neta: a range per size measured floor to top incl. the grower pot, midpoint used, tag `height-range`; Plants4u: "about N cm" per pot size). Pot diameter is not stated for neta sizes or Plants4u litre pots, so `w = d` is an estimate (tag `spread-estimated`). Live-plant prices are for the grower pot, designer pots cost more. Live plants vary in size and stock; the product page lists several sizes, the recorded one is named in the product name. Plant URL is the species page, the size is chosen in the shop.
* IKEA KRANSALG pendant: cord adjustable 20-160 cm, `h` = stated maximum 160 cm. Only one 100 cm+ linear pendant (IKEA KRANSALG 113 cm) with full data was found; ACE Oasis (71 cm long) and others are shorter. KABOMBA wall lamp and HC LED lamp: depth equals the stated diameter / width. ACE BONI floor lamp: `w = d` = 27 cm base (the page also lists a 67.7 cm length of the head that is not used).
* ACE lamps' `h` for flush lights is the stated fixture height; ACE prices have decimals (e.g. 449.25) as shown on the page.

### Dropped / blocked in this pass
* citydeal.co.il (403), KSP (blocked), plants shops azurflowers.co.il, plantify.co.il, greenme.co.il (403), hadarnoy.co.il (404 on APIs; no usable JSON); Lilach Flowers (Woo) sells mainly flower gifts, no plant heights.
* Dropped for missing dimensions: ACE tripod floor lamp 155 cm (no shade width), most ACE fans, HC lamps without height, ACE ceiling lights whose description shows only a thickness, IKEA VIDJA / SKURUP track / BAVE track / FRIHULT / IKEA PS 2026 pendants (one dimension missing), Bug Star fans (drop stated only ceiling-to-blade).
* Not added (surplus beyond 40 % cap and range): further IKEA items (KLOVING, SIMRISHAMN, LAUTERS, OKENSAND floor lamps; TARNABY, KUDDLAVA table lamps) were verified but left out to keep IKEA under 40 %.

## Gap pass 13 Nov 2026: long linear pendants (8 added)
All pages opened and the price read on the page on 13 Nov 2026; dimensions as published (mm converted to cm). `h` = stated maximum hanging height.
* IKEA Israel (price + measurements block): PILSKOTT 97 cm https://www.ikea.com/il/he/p/pilskott-led-pendant-lamp-smart-black-30477878/ (495); BACKSTORN 108 cm https://www.ikea.com/il/he/p/backstoern-led-pendant-lamp-dimmable-matt-aluminium-60577876/ (395); SAMBORD 110 cm https://www.ikea.com/il/he/p/sambord-pendant-lamp-with-3-lamps-black-white-50586961/ (195; d = shade diameter 15).
* LED Market (ledmarket.co.il, Shopify; price shown on page, size from the technical-data block of the description): VORIN (2370), AERIA (4900), DUET ART (3350), DUALIS ART (3150), SKI (901), at https://ledmarket.co.il/products/<handle>.
* Dropped (no height/drop or width published): Home Center LINE 25/40/60 cm and SPIKO (length only in the name), Technolite Axon 120 (tlite.co.il, 1890; length only), OMEGA Linea 1200 mm (best4home.co.il, 479; no spec table), World Lighting Strada 120 (out of stock), LED Market TENSA / BALANCA / BELLISIMA LINE / GOLDEN BALLS (length given, drop not), YELL G9 (75 cm only).


## Lighting & decor: indoor boutique pass, 14 Nov 2026
Added 40 products from 5 suppliers: Habitat 9, KARE 10, StudioKnob 9, Tzemer 8, Tollman's DOT 4 (blocks marked `>>> <supplier>` in `lighting-decor.js`).
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
New blocks marked `>>> <supplier>-2 (second pass 2026-11-14)` in lighting-decor.js. Per-supplier evidence, ratings (none checked, no `top-rated`), exclusions and the lists of suppliers with no public price / blocked / still skipped are in docs/CATALOG-RESEARCH.md section "Second pass (14 Nov 2026)". Summary for this file: Ubject 6 pendants, Daniel Light Design 14 pendants = 20 products.
Data origin: prices from each shop's own page (WooCommerce/Shopify store API values that equal the displayed price, Zaga/Daniel Light/Tollman's from the page text); sizes from labelled blocks on the page, or, for Kaza, from the size triple labelled depth x height x width by the site's own script; Ubject only where the unlabeled order does not matter.

## Price-on-request pass (14 Nov 2026): Karney Tchelet and Aqua Creations
Blocks `>>> karney-1` and `>>> aqua-1` (marked `price-on-request pass 2026-11-14`) in lighting-decor.js. Every product carries `price: null`, `priceOnRequest: true` and tag `price-on-request`. Full evidence and skips: docs/CATALOG-RESEARCH.md section "Price-on-request suppliers (14 Nov 2026)".

**Karney Tchelet (karney.co.il), 31 products.** Product list from the site's own sitemaps (33 `/product/` shop pages, 723 `/catalog/` pages), every page opened with the default curl client (robots.txt allows all). No page shows a price. The "מידות" field was read per page. Only pages with a diameter (ק / קוטר) and a height (ג / גובה) were used for round lamps: the letter codes were checked against the same lamp's page in full words (Flos Zero Glo-Ball: "ק: 190, ג: 160" on the shop page and "קוטר 190 מ"מ גובה 160 מ"מ" on the catalogue page) and against the manufacturer's sheet (Astro: ר = width, ג = height, ע = depth). Sizes in mm on the page are converted to cm. Pendant `h` = shade height + 60 cm cord (existing convention). Four Astro lamps take width / height / depth from the Astro data sheet PDF that the Karney page itself links (cited in each description): Cabin wall, Messina, Enna Wall LED, Enna Desk LED. Not tagged `boutique`: the about page (karney.co.il/about/) says "קרני תכלת, בית לגופי תאורה בינלאומיים, היא אחת מהחברות המשפיעות והחדשניות בתחום תאורת העילית בישראל" and "היא המשווקת הרשמית בישראל של כמה מותגי על חשובים" (an official distributor; the word boutique does not appear). No `top-rated` (no rating read). Skipped: Aromas table / wall / pendant lamps (shade size and base size both given, `ק` ambiguous), Ares outdoor lights (no unit stated), Toio and Parentesi (height range / cable only), Louis Poulsen AJ Wall (page and sheet disagree on the length), Moooi Random Light (the sheet's H / W / D are packing sizes), Flos Taraxacum / IC / Smithfield (diameter only), tracks and recessed spots without a single size.

**Aqua Creations (aquagallery.com), 54 products.** The studio's own gallery shop (Shopify, robots.txt allows all; "Founded in 1992 ... handmade to order in our studio", our-story page; no "boutique" wording, so no tag). Prices are in US dollars only on every page, so each is listed as price on request, with no conversion. Size read from the page's own "Dimensions" block; only labelled forms were used (H x Ø, or H / L / W / D with letters), products with several sizes in one block or with unlabelled "AxBxC" were skipped. Pendant `h` = published height + 60 cm cord. Colour is a selector on each page (about 16 silk colours), so `color` is a neutral placeholder.
