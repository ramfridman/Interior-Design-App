# kitchen-bath-appliances — research log

Date of research: 2026-11-13. Prices in ILS incl. VAT as shown to the shopper, `priceDate: '2026-11'`. 99 products.

## Retailers used and how data was read

| Retailer | Products | Price | Dimensions |
|---|---|---|---|
| IKEA Israel (ikea.com/il/he) | 21 | search API (`sik.search.blue.cdtapps.com`) sales price, re-read from the product page | "Measurements" block of the product page (frame sizes for METOD; fridge/oven/etc. true body sizes) |
| Home Center (homecenter.co.il, Shopify) | 24 | `products.json` variant price (equals the page price; `on-sale` tag when `compare_at_price` is higher) | dimension sentences in the product description (cm; mm values converted) |
| Traklin Hashmal (traklin.co.il) | 21 | schema.org Product JSON-LD `offers.price` on the product page (rendered with Playwright) | "Full technical spec" tab on the product page |
| ACE (ace.co.il) | 21 | category ItemList JSON-LD and product JSON-LD price | "height/width/depth" lines of the product page; showers: width from the title, height 185 cm from the page; vessel basins: W x D x H from the title |
| Samsung Israel online shop (samsung.com/il) | 12 | Product JSON-LD `offers.price` | "Dimensions" block of the page (TV: size without stand, sorted into w >= h >= d) |

No retailer exceeds 40 % of the file (largest: Home Center 24 %).

## Conventions
* TV dims: width x depth x height without stand. AC dims: indoor unit only. Soundbars: bar only.
* IKEA METOD prices are for the cabinet frame (or the listed combination); fronts, legs and worktop are separate.
* Wall-hung vanity dims include the basin; height is the cabinet height as stated.
* Shower fronts (ACE "Carmel", "Chrysanthemum"): width = upper end of the fitting range (e.g. 100-105 -> 105), h = 185 as stated; the page gives no depth, so `d: 3` (glass panel + profile) is a modelling approximation. "Troya" is a square enclosure (d = w).
* Cookers/ACs/hoods with a height range use: Lofra range 85 (adjustable feet 85-90.5); Elica hood 114 (extendable 71-114).

## Dropped / not available (caveats)
* **Toilets, bathtubs, towel rails, water heaters / solar sets, kitchen islands: none in the file.** Home Center sells wall-hung and close-coupled toilets but states only width and depth from the wall (no height); its island page gives no height; towel-rail and boiler pages have no dimensions. Per the no-guess rule they were dropped. Hamat / HeziBank pages show no prices.
* **Walk-in showers 95x160 / 110x160:** Home Center shower fronts (95-100, 110-115, 155-160) give no height, so they were dropped; ACE shower fronts (85-90, 100-105, 125-130, sliding 175-180) were used instead.
* **130 cm vanity:** no 130 cm model found; nearest stock sizes are 101 and 121 cm (Home Center, plus Barry/Tenerife series).
* Blocked (403 / Cloudflare) so not used: KSP, Ivory, Shekem Electric, Payngo (Mahsanei Hashmal), A.L.M, Harsa, lastprice. Network-unreachable: Lagoon, Tornado, Gree, Family, Tadiran sites. LG IL and Bosch IL have no prices.
* Samsung AC (AR9500T) and microwaves: dimensions ambiguous / missing on page - dropped. Samsung 'Bespoke' washer-dryer combo: dimensions not credible - dropped.
* Home Center "Orlando" 100/120 vanities (no height), 101 cm Tenerife grey (no height) - dropped.

## Price caveats
* ACE shows sale prices (valid to 30.11.26 for showers); listed price is the sale price (`on-sale` tag).
* Samsung IL page shows an "Out of Stock" template string on most pages; the listed price was still shown, so the product was kept - availability may vary.
* Traklin lists some models twice with different colours (e.g. Tornado Legend 22) - the listed URL is the colour recorded.
* Home Center delivery is extra (about 59.90 ILS per item) and is not included in `price`.

## Verification
Re-fetched 15 URLs across all five retailers (HTTP 200 and recorded price present on the page): 15 of 15 returned 200; 14 matched the price string directly and the 15th (ACE Troya, 1,439.90 ILS) matched after format normalisation.

## Gap-filling pass (2026-11-13): sanitary ware, bathtubs, towel rails, water heaters, islands, mirrors, cabinets

43 products appended (ids unique, `loadCatalog()` accepts all). Prices ILS incl. VAT, `priceDate: '2026-11'`.

| Retailer | Products | How price / dimensions were read |
|---|---|---|
| Makina (makina.co.il, WooCommerce) | 12 | Store API `/wp-json/wc/store/products` for the list, then the product page JSON-LD `price` (sale price = lower of the two UnitPriceSpecification values; `on-sale` tag, list price in `description`). Dimensions from the "מידות" lines of the product description (toilet length/width/height, tub L x W x H). |
| IKEA Israel | 10 | Search API price, re-read from the product page; "Measurements" block of the page (all three dimensions present). |
| ACE | 10 | Product JSON-LD price; dimensions from "מידות" text of the description (toilets: length/height/width; cabinets: W x D x H). LED mirrors: diameter / width x height from the title. |
| Keter Dudim (keter-dudim.co.il, WooCommerce) | 7 | Store API price = page JSON-LD price; diameter and height from the description (w = d = diameter). |
| Ambat4U (ambat4u.co.il, WooCommerce) | 3 | Page JSON-LD price; dimensions from the description (tub outer size; towel ladders in mm converted). |
| Home Center | 1 | products.json price; service-cabinet dimensions in the description. |

Largest share: Makina 28 %.

### Conventions / approximations
* Toilets: w = bowl width, d = projection from the wall (length), h = height as stated by the shop (pan height; for the smart toilet height incl. seat). Wall-hung models need a concealed frame, which is not included.
* Boilers / solar tanks: w = d = body diameter, h = height as in the headline spec line (the pages also list slightly different inner values). Solar tanks are tagged `variant: 'solar-roof'`; collectors and frames are separate items.
* Towel rails: dimensions as stated (Omnezza ladder 1600 x 450 x 85 mm, folding warmer open 855 x 500 x 70 mm; ATMOR 5-bar 65 x 60 x 12.5 cm; Makina 8-bar 80/52 cm + 10 cm off the wall).
* Frameless LED mirrors (ACE): thickness is not stated, `d: 3` is a modelling approximation (same convention as the shower glass in the first pass).
* Freestanding / built-in tubs are sold without frame, overflow, filler or taps.

### Dropped / not found
* Home Center wall-hung and monoblock toilets (TOKYO, MANILA, SEOUL, TAO, EMILIYA, BUFALO, wall-hung sets): pages give only width and depth, no height (the BUFALO dimensions quoted by a search summary are not on the page) - dropped. Home Center electric towel heaters (3-stage 12.5*56*45, shelf models 35.3*61*57): axis order not stated - dropped. Home Center has no tubs or boilers.
* IKEA towel rails (BROGRUND, BROFJÄRDEN, BÄSINGEN, ENUDDEN, VILTO): height or depth missing - dropped.
* ACE ATMOR 8-bar towel warmer (3031481): no dimensions on the page - dropped. ACE sells no tubs or boilers.
* Keter Dudim heat pumps (Chromagen Eco-Heat 110/280 L): no dimensions on the page - dropped; combined solar kits: no dimensions - dropped. Gas (Hamgaz) and 60 / 30 / 45 L boilers not needed.
* Makina "toilet + frame" sets and variable-size mirrors (size chosen in a drop-down): skipped. Ambat4U wall-hung toilets state only width/depth - dropped. Ambat4U 8167/5834 smart toilet duplicates the Makina SUPERA - not used.
* 150/160/170 cm built-in acrylic tubs: Makina lists only 110/130 cm built-in (130 cm used); Ambat4U 180 x 70 used. MTI 170 cm models (Marco, Sharon, Hamefales, Makina MAK-07) appeared in search results but their pages were not fetched/verified, so they are not included.
* No walk-in shower screens/trays were added (first pass already has ACE enclosures).
* Not reachable / not used: Sharon Ceramic Woo API returned 0 products; Conex and Oz Ceramica feeds fetched but not mined.

### Verification
Random sample of 12 of the new URLs re-fetched: 12 of 12 returned HTTP 200 and showed the recorded price.

## Added 14 Nov 2026: new-supplier pass (appliances, bathroom)

32 products from 4 suppliers not previously in the catalogue; prices as displayed, read 14 Nov 2026; dimensions from the product page text.

| Supplier | What it is | Rating read 14 Nov 2026 | Products |
|---|---|---|---|
| Golan Westline (golan-westline.co.il) | Official importer of SMEG and White Westinghouse in Israel, "30 years in luxury kitchen appliances" (home page text); the Smeg retro fridge carries tag `boutique` | rating not checked | 8: 5 White Westinghouse fridges, 1 Smeg retro fridge, 1 Vintec wine cooler, 1 induction hob |
| Bath Boutique (bathboutique.co.il) | Importer of bathroom furniture, shower enclosures and sanitary ware, "over 30 years", sells directly (about page); listed as a boutique store on Easy.co.il. Tag `boutique` | rating not checked (a Zap result lists 11 reviews and no aggregate score; the page was not opened) | 11: 2 vanities, 2 wall-hung toilets, 3 basins, 2 mirrors, 2 bathtubs |
| Bol Parket (bolparket.com) | Parquet, wall-cladding and lighted-mirror showroom in Petah Tikva (pricing page) | its product pages show "5.0 from 202 Google reviews". Tagged `top-rated` | 6 LED mirrors here (20 finishes in finishes.sources.md) |
| Merkaz HaOdafim (merkazod.co.il) | Discount appliance store, about 300 m2 in Petah Tikva, 20 years (home page) | 5-star icons, "excellent", based on 75 reviews, no numeric average; not tagged | 7: 2 integrated fridges, 2 integrated dishwashers, 2 built-in ovens, 1 induction hob |

Method and caveats:
* Golan Westline, Merkaz HaOdafim: WooCommerce store API for the list, product pages for price (JSON-LD) and dimensions (page text; Golan pages give them in the short description for the White Westinghouse range and the Smeg retro fridge, and in mm for the Vintec). Many Smeg pages give no dimensions in the text (data sheet is a PDF) and were skipped (hoods, ovens, hobs).
* Bath Boutique: JSON-LD `valueAddedTaxIncluded: true` (prices include VAT). Vanities that are sold "width 60-150 cm" with a width-dependent price were skipped; only fixed-size vanities and parts were added. Delivery and installation are priced separately. Two items (Belgian vanity, floating mirror) are flagged "stock clearance, no returns" on their pages.
* Bol Parket: prices include VAT (FAQ: "all prices on the site include VAT"). Mirror depth is not published (3 cm modelled).
* Golan / Merkazod: the page does not state the VAT basis; displayed prices are used. Merkazod colours are not stated, so a neutral grey is used and noted.
* `type` mapping: fridges by door layout; integrated dishwashers `integrated`; built-in oven `range` / `built-in-oven`; hobs `cooktop`; basins `sink` / `vessel`.
* Skipped: Hezibank, Alony, Hamat, Negev (no prices on product pages or a price list in a PDF, ex-VAT); Kosko, Hrsena, Bathline (not read in depth); Porcelanita vanities (width-configurable price); taps and shower mixers (no model type).
