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
