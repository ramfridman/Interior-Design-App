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
