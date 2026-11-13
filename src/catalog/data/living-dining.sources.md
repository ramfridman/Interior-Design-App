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
