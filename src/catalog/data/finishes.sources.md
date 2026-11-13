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
