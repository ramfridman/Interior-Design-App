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
