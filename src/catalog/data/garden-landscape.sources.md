# garden-landscape — research log (read 2026-11, prices in ILS)

122 products, zone `outdoor`, categories plants / planters / surfaces / outdoor-utility.
Every name, price, URL and dimension was read from a retailer page or its public JSON in this task.
A generator script rebuilt the data file from the fetched JSON, so prices are copied, not typed.

## Retailers and how data was read

| Retailer | Products | Price / dimension source |
| --- | --- | --- |
| Organi-Co nursery (organi-co.co.il) | 38 | WooCommerce store API (`/wp-json/wc/store/products`). Variable products: the price of the named container size read from `?parent=<id>&type=variation`. Pot dimensions are in the product titles. |
| Eyal nursery (gardencenter.co.il) | 34 | Shopify `/products.json`. Dimensions from title or description (corten pots, arches, stones, grass pile heights). |
| ACE | 19 | Category JSON-LD `ItemList` for price; product page for dimensions. Synthetic grass: the page's own "price per m2" line. |
| Home Center | 17 | Shopify `/collections/<c>/products.json`; dimensions from the description text. |
| IKEA Israel | 7 | Product page: embedded price + measurements block. |
| Nitzanim nursery (mygreen.co.il) | 7 | Wix store sitemap + product-page JSON-LD (`Offer.price`); dimensions from description. |

Re-verification: a random sample (11 + 4 URLs across all six retailers) returned HTTP 200 and the recorded price appeared on the page.

## Conversions and conventions

* Plants: the seller states only the container (e.g. 25 L), sometimes "4-6 inch" trunk caliper. `dims` is a mature-size estimate for planning (horticultural knowledge, tag `mature-size-estimate`); the description states both the delivered size and the mature size.
* Variable WooCommerce products show a price range on the page ("from"); the recorded price is the one for the container size named in the product.
* Sod (Eyal): price tier for 10-29 m2 self-pickup; a cheaper 30 m2+ tier exists as a separate listing (Kikuyu 21, El Toro 26 per m2).
* ACE synthetic grass: rugs are sold by piece; `price` is the per-m2 price printed on the page.
* IKEA RUNNEN (pack 125 for 0.81 m2 -> 154.32/m2), Home Center Cameo grass tiles (49.90 -> 61.60/m2) and Verde acacia tiles (98 -> 121/m2): converted using the coverage stated by the seller.
* Home Center Negev grass is a 15 m2 roll, so it is priced per roll (`priceUnit: item`).
* Sale prices are used where shown (tag `on-sale` on ACE items with an old price).
* Assumed values (flagged in the description): stepping-stone thickness, depth of one arch, footprint of a gnome and bird feeder.

## Dropped, and why

* KSP: not queried (403 by brief). azurflowers.co.il: Cloudflare challenge. hadarnoy.co.il: API forbidden. hamashtela.co.il (bonsai shop): off-topic for garden design.
* Home Center plants: only seeds and artificial plants. Artificial plants (IKEA FEJKA, ACE, Home Center) are not garden plants and were skipped.
* Home Center porcelain tiles and IKEA/other tile lists: the price unit (per m2 or per box) is not stated on the page, so they were dropped.
* Bulk gravel, tuff, basalt chip and pebbles (Eyal, Organi-Co): sold per tonne / m3 / bag without coverage or bag dimensions, so they cannot be given a verified m2 price or size.
* Controllers and hose reels without stated dimensions (Netafim, Galcon, Bermad, Home Center reels): dropped. Only the Hunter BTT-101 (16 x 5 x 10 cm) has dimensions on its page.
* Composters (Eyal): volume only. No online seller with a priced WPC deck, concrete pavers, fountain or bird bath and stated dimensions was found, so these types are missing (gap).
* Date palm and Washingtonia: no in-stock listing with price found.

## Caveats

* ACE delivery excludes some areas (its delivery text lists "בקעת הירדן" for some products): check delivery to Afikim before ordering.
* Plant stock is seasonal; some listings can go out of stock between the research date and purchase.
* Prices are as shown on the shop (VAT included); sod and large plants may carry separate delivery fees.

## Planting guide for the Afikim lot (Jordan Valley, about 200 m below sea level)

Climate: summer highs of 38-42 C, mild frost-free winters, under 300 mm rain, brackish soils and water in places. Plan for drip irrigation and a heat-tolerant plant list.

**Best performers (low risk)**
* Date palms and other palms (sun, heat, salt tolerant; royal and foxtail palms need regular water).
* Olive (Barnea / Syrian): full sun, very drought tolerant once established, 350 x 350 cm. Carob: slow, huge shade tree for the back of the lot.
* Pomegranate, fig, citrus (lemon, lime, pomelo, orange, clementine): thrive in the valley heat; deep drip watering every 3-5 days in summer; mulch the root zone; protect young citrus trunks with whitewash.
* Bougainvillea, lantana, duranta, vitex, rosemary, agave, yucca, aloe, adenium: full sun, little water; ideal for the street side and gravel beds.
* Jacaranda, plumeria, moringa, mango, avocado: possible but give mango and avocado afternoon shade when young and wind protection; avocado needs good drainage and low-salt water.

**Sun and shade**
* South and west sides get the harshest sun: use shade trees (carob, mulberry, fig, jacaranda) and climbers on pergolas (bougainvillea, grape, passion fruit, jasmine).
* Keep palms and large trees at least 4-5 m from the house wall and drainage lines.
* Dark-coloured pots overheat; choose light fibre-clay or double-wall pots and keep roots shaded.

**Water needs (typical)**
* Very low: olive, carob, agave, yucca, bougainvillea, lantana, rosemary, vitex.
* Medium: pomegranate, fig, citrus, hedges (ficus, myrtle, duranta), shrubs.
* High: lawn, banana, mango, roses, hibiscus. Group high-water plants on one irrigation zone.

**Lawn and surfaces**
* Natural lawn: Kikuyu and El Toro zoysia suit full sun and heat; expect high summer water use, so keep the lawn small. Synthetic grass (38-45 mm) stays cooler with a light shade and a watering mist on very hot days.
* Hard surfaces and dark stone get very hot in July-August: prefer light-coloured stone, wood-look porcelain or shaded decking.
* Gravel and tuff mulch on plant beds reduces evaporation; use it with drip lines.

**Irrigation**
* Put every tree and bed on drip lines with a timer or controller (battery or mains). Water deeply and early (before 6 a.m.).
* Salinity: flush root zones with extra water in winter if the local water is brackish.

## Gap pass 13 Nov 2026 (20 added); every page opened and price read on 13 Nov 2026
* Water features (type water-feature, subcategory water-features): Aquarium King / Beit Hobby Online (aquarium-king.co.il; price + "גובה/רוחב/עומק" in the product text): classic 2-tier 1790, classic 3-tier 3290, palace tiers 4790, ball tiers 3000, rock 11 1190, stone ball 995. Tropical Fish (tropicalfish.co.il) waterfall TGF-8537 1949 (45 x 25.5 x 82.5 cm; delivery 100 extra). All include pump. Delivery fees are extra.
* Stepping stones (subcategory paving, price per stone, pickup only): Bialik Nurseries (bialik-mashtelot.com) large off-white 40X60X4 (55) and basalt amorphous 40X50X3 (79 sale). Sizes are stated as approximate, stones are irregular.
* Palm: Gan Yarak Online (gan-yarak.co.il) Phoenix roebelenii 25 L, 180. The page states height 3 m and planting spacing 1.5 m; w = d = 150 cm is that spacing (tag `spread-from-planting-spacing`).
* Clothes racks / wall rack (subcategory clotheslines): IKEA MULIG 125 and JALL 39 (measurements block); ACE Almog 76.19, Milano 137.30, Liberty 169.42 (ACE page JSON-LD price, dimensions in description); Home Center CLEANIC wall rack 69.90 (online special price; 79.90 in store).
* Composters (type utility variant compost, category outdoor-storage / bins because no composter subcategory exists): Composter.co.il Harmony 420 L 435 and rotating 160 L 335 (sale prices, regular 580/420); gardensheds.co.il (Adar for all) L105 tumbler 199.95 and 300 L 278 (sale prices; dimensions are in the site's catalogue listing text).
* Dropped / not found:
  * Bird baths: no free-standing bird bath sold by an Israeli shop with price and size was found.
  * WPC / composite decking: Carmel Floor UH100R boards (140 x 25 mm, 2.20 / 4.05 m, 295) and 30x30 tiles (265 per 9) show no price unit (per board or per m2) or tile thickness; Avieli 30x30 tile (149 per m2) states no material or thickness; take-deck.co.il shows prices ex VAT only; Decoplus page blocked / empty. None added.
  * Concrete pavers: no Israeli retailer page with concrete pavers or stepping stones, price and size was found online. Knv.co.il Hadassah stone is sold as "50-90 cm" (range only), Bialik round basalt has no thickness, small off-white stone size "30X40X40" is ambiguous, hadarnoy.co.il lists no dimensions.
  * Date palms / large specimen palms: nurseries list pot sizes without trunk height or canopy (e.g. Phoenix dactylifera 25 L 480 at mashtelaadhabait.com has no height); Zeraviv roebelenii 50 L (250, final height 2.5 m) and Gan Yarak ring palm 25 L (250, 2 m) have no spread, so not added.
  * Heat-pump water heaters: Mashav (mashav.com and electra.mashav.com) lists Tadiran WATEC 150/200 (5450/5790) and Electra EcoWater 150-300 (4490-5990 on mashav.com, 5990-8890 on electra.mashav.com, the two sites disagree) with no dimensions on the page; Keter Dudim Chromagen Eco-Heat has none either; Thermostar Electra 150L page gives an unlabeled 500/500/1670. None added.
  * Rotary clotheslines (Leifheit Linomatic 500/600 on Home Center): sold by an unnamed external seller and no height on the page. Composters at gardencenter.co.il (GREEN 60 / 130 L): volume only, no dimensions.
