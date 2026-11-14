# finishes.js sources (read 2026-11)

118 products: wall-paint 48, parquet-laminate 27, floor-tiles 20, wall-tiles 10, wallpaper-cladding 8, outdoor-tiles 5.
Retailers: ACE 30, Home Center 29, tile.co.il 29, Icezar 24, Inbal Tiles 6.

* **Tambour colours (ACE)**: names, codes and hex read from the official tambour.co.il hue pages (`data-hex`, LRV). Price: ACE page https://www.ace.co.il/1116005 (Supercryl matt 5 L, 119; page states ~16 m2/L; Tambour site states 15-16 m2/L in two coats; 15 used). Same base price used for every shade (tinting and base differences not priced).
* **Nirlat colours (Home Center)**: names and hex from nirlat.com annual-hues page (`the-hue` background). Price: Home Center Aquanir EXTRA base A 5 L = 129.90 (JSON feed `/collections/.../products.json`); nirlat.com product page states 13 m2/L in two coats (maximum, ~75 % practical).
* **Home Center laminate/SPC**: product JSON + rendered page ("מחיר למ"ר"). Plank sizes are not published on the pages; render sizes are typical values (stated in each description). Dropped: Muller Graff laminate/SPC (price per pack ambiguous), one laminate whose page and feed price disagreed. Home Center porcelain/ceramic tiles and wallpapers dropped: the page does not state per m2 vs per piece/roll.
* **Icezar (icezar.co.il)**: page JSON-LD (price, name, image) plus on-page text "price per m2 incl. VAT". Wall slat bars and brick sheet converted to per m2 from page dimensions (arithmetic in description). Wallpaper: 390 per 53 cm x 10 m roll. Dropped: Quick-Step (price "call"), pages without a stated unit. Some prices are sale prices ("מחיר מוזל").
* **tile.co.il**: Woo Store API (`/wp-json/wc/store/v1/products`); site states prices are per m2; VAT inclusion not stated on page. Product titles are generic, and listing photos are room shots, so colours are estimated by eye (tag `hex-estimated`).
* **Inbal Tiles**: page states "price per m2 + VAT"; 18 % added.
* Paint colour hex for Tambour/Nirlat are official; all other hex are estimates from photos.
* Not found / blocked: HeziBank, Alony, Negev, Zehavi, Topcer (showroom sites with no prices or unreachable); acoustic wood-slat panels and micro-cement had no priced Israeli listing (woodpanelwallisrael.com shows price 0); polymer 3D slats are decorative only.
* Caveat: Home Center HTML needed a browser UA; coupons (e.g. Icezar NOV2026) not applied.

## Added 14 Nov 2026: new-supplier pass (floors, wall finishes, outdoor tiles)

26 products from 2 suppliers not previously in the catalogue. All prices converted to ILS per m2 where the page sells by sheet or roll; the arithmetic is in each description.

| Supplier | What it is | Rating read 14 Nov 2026 | Products |
|---|---|---|---|
| Bol Parket (bolparket.com) | Parquet / wall-cladding showroom, Ein Ganim 96, Petah Tikva; Shopify shop | product pages show "5.0 from 202 Google reviews" (read on the pages, 14 Nov 2026). Tagged `top-rated` | 20: 13 floors (laminate, SPC, rigid vinyl, LVT, 3-layer oak), 3 wallpapers, 4 wall panels |
| Porcelanita (porcelanita.co.il) | Ceramics, flooring and bathrooms showroom in Ashkelon; Italian and Spanish tile brands (home page) | rating not checked | 6 (porcelain tiles and one natural basalt paving) |

* Bol Parket: price per m2 as shown on the page ("NN per m2"); the Shopify price field is the pack price, not used. FAQ: all prices include VAT. Plank sizes are the published board sizes. Colours were sampled from the product photos (median of the central pixels, tag `hex-estimated`). Wallpaper rolls: price per roll / (roll width x length, 0.53 x 10.05 m). Polymer panels 120 x 280 cm / 120 x 60 cm: price per sheet / area, plus a special freight fee (150-295) on the page that is not in the price.
* Porcelanita: the WooCommerce API price is the price per carton; the page shows "consumer price per m2" and "site sale price per m2"; the site sale price per m2 is recorded with tag `on-sale`. VAT basis not stated. Natural stone "Bluestone Basalt" crazy paving has the same price 325 per m2 as consumer and site price; random shapes, average thickness 2-3 cm, so the rendered tile size (40 x 40 cm) is only a drawing aid. Pages for other ARI stone products copy the Bluestone text, so they were not used. Another item (Bodo 20 mm) states 60x60 in the title and 60x120 in the text and was skipped.
* Earlier unsourced gap "paving / stepping stones, concrete pavers": still no concrete pavers; Porcelanita adds natural basalt paving by the m2.
* Skipped: Hezibank, Alony, Negev (no prices on their product pages); Hetzroni (hardware, not tiles); Oz Ceramics and Halamish (not read in depth); Tambour and Nirlat have no online prices.
