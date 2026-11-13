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
