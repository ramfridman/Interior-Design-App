# Carpentry price book – sources and derivations

Compiled 2026-11-13. Output file: `pricebook.js` (ILS, **excluding VAT**, VAT = 18 %).
All pages were fetched by the researcher on 2026-11-13 (Hebrew-language Israeli sites). Source dates are those shown on the page; "undated" means the page shows none.

## Method and VAT convention

* Where a source states its VAT status it is used as stated: **pro.co.il** and **Tsidky** are VAT-inclusive; **kitchensdesign.co.il** is ex-VAT.
* Where a source does not state VAT (most price guides, showroom pages, hardware shops) the figure is **assumed VAT-inclusive** (Israeli consumer-facing prices) and divided by 1.18. If a source was really ex-VAT, the ex-VAT ranges in the data file are about 15 % too low.
* `low / high` = lowest / highest bound published by the sources used (after conversion), `typical` = median (or mid-point for a single source) of source mid-points ex VAT. Derivation is given per key.
* Several guide sites (akitchen.co.il, yagel-mitbachim.co.il, kitchensdesign) republish the same Midrag / Bizportal-style figures; they are noted as not fully independent. For the headline kitchen and wardrobe rates at least four different sites are used.
* Rounding: values above 200 rounded to the nearest 5 ILS.

## Source register

| Id | Site | URL | Date | VAT status |
|---|---|---|---|---|
| pro | המקצוענים (pro.co.il) – מחירון נגרים | https://www.pro.co.il/carpenters/pricing | 2026-11 (fetched 2026-11-13; page undated, live price list) | incl. VAT (stated on page) |
| dco | דפי זהב – מחירון נגריות ועבודות נגרות | https://www.d.co.il/priceList-33575/ | 2026 (undated page, © 2026; fetched 2026-11-13) | VAT not stated – assumed incl. |
| dco2 | דפי זהב – מחירון מטבחים | https://www.d.co.il/priceList-45690/ | 2026 (undated page, © 2026; fetched 2026-11-13) | VAT not stated – assumed incl. |
| ksd | המטבח שלי – מחירון מטבחים | https://www.kitchensdesign.co.il/%D7%9E%D7%97%D7%99%D7%A8%D7%95%D7%9F-%D7%9E%D7%98%D7%91%D7%97%D7%99%D7%9D | 2026-11 (page: "updated November 2026") | EXCL. VAT (stated on page) |
| yagel | יגל מטבחים – מחירי מטבחים | https://www.yagel-mitbachim.co.il/%D7%9E%D7%97%D7%99%D7%A8%D7%99_%D7%9E%D7%98%D7%91%D7%97%D7%99%D7%9D/ | 2026 (undated; fetched 2026-11-13) | VAT not stated |
| lacasa | לה קאסה – מחירון מטבחים 2026 | https://www.la-casa.co.il/kitchen-prices/ | 2026 (page titled 2026) | VAT not stated – assumed incl. |
| akitchen | א.ע ריהוט ומטבחים – כמה עולה מטבח מעוצב (מדריך 2026) | https://www.akitchen.co.il/blog/kitchen-cost-israel | 2026-10-22 | VAT not stated – assumed incl.; compiles Midrag + Bizportal figures (not independent of them) |
| container | הקונטיינר – כמה עולה מטבח חדש (2026) | https://www.container.org.il/%D7%9B%D7%9E%D7%94-%D7%A2%D7%95%D7%9C%D7%94-%D7%9E%D7%98%D7%91%D7%97-%D7%97%D7%93%D7%A9/ | 2026 (page titled 2026) | VAT not stated per row (FAQ: "most quotes include VAT") – assumed incl. |
| nirzvi | ניר צבי – מחירון שיש למטבח | https://nir-zvi.co.il/marble-pricing/ | 2026 (page © 2026, undated price list; fetched 2026-11-13) | VAT not stated – assumed incl. |
| bizwar | ביזפורטל – ארון בגדים: מדריך מחירים | https://www.bizportal.co.il/guides/news/article/20042225 | 2026-09-15 | VAT not stated – assumed incl. |
| slidoor | סליידור – כמה עולה ארון מנגר? מדריך מחירים 2026 | https://www.slidoor.co.il/%D7%9E%D7%90%D7%9E%D7%A8%D7%99%D7%9D/%D7%A2%D7%9C%D7%95%D7%AA-%D7%90%D7%A8%D7%95%D7%9F-%D7%9E%D7%A0%D7%92%D7%A8/ | 2026 (page titled 2026) | VAT not stated – assumed incl. |
| b144 | בזק B144 – מחיר ארון קיר | https://www.b144.co.il/PriceList/%D7%A0%D7%92%D7%A8%D7%99%D7%9D/%D7%90%D7%A8%D7%95%D7%9F-%D7%A7%D7%99%D7%A8/ | undated (fetched 2026-11-13) | VAT not stated – assumed incl. |
| bvn | היופי שבעיצוב – כמה עולה מטבח אצל נגר | https://www.bvn.co.il/how-much-does-a-kitchen-cost-from-a-carpenter/ | undated (fetched 2026-11-13) | VAT not stated – assumed incl. |
| tsidky | אצל צדקי – מחסן עצים (חומרים ומחירים) | https://etsel.tsidky.co.il/materials-and-prices/ | undated (fetched 2026-11-13) | incl. VAT (column header "כולל מע"מ - ללא חיתוך") |
| ponyp | פוני פרזול (רמלה) – צירי בלום | https://ponyp.co.il/%D7%A6%D7%99%D7%A8%D7%99%D7%9D/%D7%A6%D7%99%D7%A8%D7%99%D7%9D-%D7%A9%D7%9C-%D7%97%D7%91%D7%A8%D7%AA-%D7%91%D7%9C%D7%95%D7%9D | online shop, fetched 2026-11-13 | VAT not stated – retail shop, assumed incl. |
| ponyp2 | פוני פרזול – מוצרים לארונות הזזה / מגירות VISION דומסיל / ידיות שקועות | https://ponyp.co.il/catalog.asp?t1=29 | online shop, fetched 2026-11-13 | VAT not stated – retail shop, assumed incl. |
| gold | גולד פרזול – צירי בלום | https://www.gold-pirzul.co.il/9202000514 | online shop, fetched 2026-11-13 | VAT not stated – retail shop, assumed incl. |
| gerassi | פרזול ג׳רסי – Legrabox (יבוא מקביל) | https://www.pirzul-gerassi.com/index.php?dir=site&page=catalog&op=category&cs=3505 | online shop, fetched 2026-11-13 | VAT not stated – retail shop, assumed incl. |
| homecenter | הום סנטר – פס לד 5מ׳ 24VDC | https://www.homecenter.co.il/products/1706428702251 | online shop, fetched 2026-11-13 | VAT not stated – retail, assumed incl. |
| ynet | ynet כלכלה – חיתוך או הגבהה של שיש? | https://www.ynet.co.il/economy/article/s1t7zqx1j | undated article (fetched 2026-11-13) | VAT not stated for cut-outs (stated incl. for raise-work) – assumed incl. |

## Rates

### `kitchen.cabinets.per-m.basic` — Kitchen cabinets, basic (laminate / melamine carcass), per running metre

* Data: unit **m**, low **930**, typical **1270**, high **1550** (ILS ex VAT; confidence: medium)
* Covers: ארון מטבח סטנדרטי (גוף סנדוויץ׳/מלמין, דלתות MDF בפורמייקה) למטר אורך; לפי המקורות ללא מגירות/פרזול מיוחד, ללא משטח, מכשירי חשמל, פירוק והתקנה
* Sources: pro, dco2, ksd, lacasa, akitchen
* Source figures as published:
  * pro.co.il (incl. VAT): kitchen cabinet formica 1,100–1,500 /m → ex VAT 932–1,271
  * d.co.il (VAT unstated, assumed incl.): formica kitchen 1,240–1,650 /m, "no special drawers/hardware" → 1,051–1,398
  * kitchensdesign (EXCL. VAT, Nov 2026): formica kitchen 1,100–1,550 /m → 1,100–1,550
  * La Casa 2026 (VAT unstated, assumed incl.): formica/sandwich 1,200–2,500 /m → 1,017–2,119
  * akitchen 2026-10-22 (quoting Midrag/Bizportal, assumed incl.): formica 1,200–1,800 /m → 1,017–1,525
  * Cross-check only (yagel-mitbachim, same figures as kitchensdesign): formica 1,100–1,650. Outlier not used for the range: container.org.il fronts "formica" 2,500–3,800 /m (→2,119–3,220 ex) – a different definition (fronts+body incl. extras) than the other five sources.
* Derivation: low = lowest ex-VAT low among the 3 price-guide sources that publish the base spec (pro.co.il 1,100/1.18 = 932). typical = median of the five source mid-points ex VAT (1,102; 1,225; 1,271; 1,325; 1,568 → 1,271). high = 1,550 (kitchensdesign upper bound, ex VAT; Midrag-derived 1,525 agrees). La Casa’s upper end (2,119) is shown as an outlier, not used.

### `kitchen.cabinets.per-m.mid` — Kitchen cabinets, mid (polymer / lacquered MDF / veneer), per running metre

* Data: unit **m**, low **1270**, typical **1710**, high **2700** (ILS ex VAT; confidence: medium)
* Covers: ארון מטבח עם דלתות פולימר / אפוקסי (לכה בתנור) / פורניר על MDF, גוף סנדוויץ׳, למטר אורך; בסיס סטנדרטי ללא פרזול מיוחד, ללא משטח
* Sources: pro, dco2, ksd, lacasa, akitchen
* Source figures as published:
  * pro.co.il (incl.): polymer 1,500–2,000 → 1,271–1,695; epoxy/lacquer 1,800–2,500 → 1,525–2,119; veneer 1,400–2,000 → 1,186–1,695
  * d.co.il (assumed incl.): polymer 1,500 → 1,271; veneer 2,000 → 1,695; epoxy 2,000 → 1,695
  * kitchensdesign (EXCL.): polymer 1,450–2,000; epoxy 1,720–2,700
  * La Casa (assumed incl.): baked-paint / polymer 1,700–2,400 → 1,441–2,034
  * akitchen (Midrag/Bizportal, assumed incl.): veneer 1,700–2,700 → 1,441–2,288
  * Outlier not used: container.org.il "שלייפלק (baked epoxy)" 3,700–6,000 /m (→3,136–5,085 ex) and glass fronts 5,000–8,000.
* Derivation: low = 1,500/1.18 = 1,271 (pro.co.il polymer lower bound, matches d.co.il). typical = median of the ten source/finish mid-points ex VAT (1,271; 1,441; 1,483; 1,695; 1,695; 1,725; 1,737; 1,822; 1,865; 2,210 → 1,710). high = 2,700 (kitchensdesign epoxy upper bound, ex VAT).

### `kitchen.cabinets.per-m.premium` — Kitchen cabinets, premium (solid wood / glass / high-end finish), per running metre

* Data: unit **m**, low **2205**, typical **3520**, high **5930** (ILS ex VAT; confidence: low)
* Covers: עץ מלא / דלתות זכוכית / גימור יוקרתי, למטר אורך (חלק מהמקורות: ארונות בלבד, ללא משטח ומכשירים)
* Sources: pro, dco2, ksd, lacasa, container
* Source figures as published:
  * pro.co.il (incl.): solid-wood kitchen 2,600–3,300 /m → 2,203–2,797
  * d.co.il (assumed incl.): solid-wood kitchen 2,060–3,100 /m → 1,746–2,627
  * kitchensdesign (EXCL.): solid wood 2,600–3,250
  * La Casa (assumed incl.): solid wood 4,000–7,000+ /m → 3,390–5,932
  * container.org.il (assumed incl.): solid wood fronts 4,800–10,000 /m → 4,068–8,475; baked epoxy 3,700–6,000 → 3,136–5,085; glass 5,000–8,000
* Derivation: Two clusters: price-guide aggregators ≈ 2,200–3,300 and showroom/manufacturer sites ≈ 3,400–8,500. low = 2,600/1.18 (pro.co.il). typical = median of mid-points ex VAT (2,187; 2,500; 2,925; 4,110; 4,661; 6,271 → 3,520). high = 7,000/1.18 = 5,932 (La Casa); container’s 8,475 top end is a luxury outlier. Wide spread → confidence low. Handle-less / integrated profiles / luxury import kitchens can exceed this.

### `kitchen.tall-unit.per-unit` — Tall / pantry unit (≈2 m high), per unit

* Data: unit **unit**, low **1100**, typical **2010**, high **2540** (ILS ex VAT; confidence: medium)
* Covers: ארון גבוה/מזווה בגובה כ-2 מ׳, כולל מדפים (ksd: רוחב 100 ס״מ, 4 מדפים; דפי זהב: רוחב 60 ס״מ, תלוי בפרזול ובמספר המגירות)
* Sources: ksd, dco2
* Source figures as published:
  * kitchensdesign (EXCL.): kitchen/pantry cabinet 1 m wide × 2 m high with 4 shelves 1,100–2,500
  * d.co.il (assumed incl.): pantry cabinet 60 cm wide × ~2 m, 1,400–3,000 → 1,186–2,542
* Derivation: low = 1,100 (ksd); high = 3,000/1.18 = 2,542 (d.co.il); typical = average of the two mid-points (1,800 and 2,214 → 2,010).

### `kitchen.island.per-m` — Kitchen island cabinets, per running metre

* Data: unit **m**, low **1185**, typical **1905**, high **2540** (ILS ex VAT; confidence: medium)
* Covers: אי מטבח, מחיר למטר רץ (גוף ודלתות, ללא משטח)
* Sources: ksd, dco2
* Source figures as published:
  * kitchensdesign (EXCL.): standard kitchen island 1,500–2,400 /m
  * d.co.il (assumed incl.): kitchen island 1,400–3,000 /m → 1,186–2,542
* Derivation: low = 1,400/1.18 = 1,186; high = 3,000/1.18 = 2,542; typical = average of the two mid-points (1,950 and 1,864).

### `kitchen.island.per-unit` — Kitchen island 90×150 cm, laminate finish, whole unit

* Data: unit **unit**, low **8475**, typical **10595**, high **12710** (ILS ex VAT; confidence: low)
* Covers: תכנון ובניית אי 90×150 ס״מ בגימור פורמייקה (ללא משטח)
* Sources: pro
* Source figures as published:
  * pro.co.il (incl.): "installing an island in the kitchen", 90×150 laminate, 10,000–15,000 → 8,475–12,712
* Derivation: Published range kept; typical = mid-point (12,500 incl. → 10,593). Single source.

### `kitchen.corner-fitting.per-unit` — Corner cabinet with carousel / magic-corner fitting, per unit

* Data: unit **unit**, low **845**, typical **1560**, high **2500** (ILS ex VAT; confidence: low)
* Covers: ארון פינה עם קרוסלה / מג׳יק קורנר / למנץ (פרזול ותוספת עבודה)
* Sources: dco2, ksd
* Source figures as published:
  * d.co.il (assumed incl.): hardware for corner cabinet (carousel/magic corner/Lemans) 1,000–2,000 → 847–1,695
  * kitchensdesign (EXCL.): custom corner kitchen cabinet (carousel, pull-out drawers) 1,200–2,500
* Derivation: low = 1,000/1.18; high = 2,500 (ksd, ex VAT); typical = average of mid-points (1,271 and 1,850).

### `kitchen.lift-up-unit.per-unit` — Wall unit with lift-up (kalpa) door, 60 cm, per unit

* Data: unit **unit**, low **650**, typical **1100**, high **1695** (ILS ex VAT; confidence: low)
* Covers: ארון קלפה (דלת מתרוממת) ברוחב 60 ס״מ עם בוכנה סטנדרטית
* Sources: ksd, dco2
* Source figures as published:
  * kitchensdesign (EXCL.): kalpa cabinet 60 cm 650–1,200
  * d.co.il (assumed incl.): kalpa 60 cm with standard piston 1,000–2,000 → 847–1,695
* Derivation: low = 650; high = 2,000/1.18 = 1,695; typical = average of mid-points (925 and 1,271 → 1,100).

### `kitchen.lift-up-unit-120.per-unit` — Wall unit with lift-up (kalpa) door, 120 cm, per unit

* Data: unit **unit**, low **1270**, typical **1590**, high **2120** (ILS ex VAT; confidence: low)
* Covers: ארון קלפה ברוחב 120 ס״מ
* Sources: dco2, pro
* Source figures as published:
  * d.co.il (assumed incl.): kalpa 120 cm 1,500–2,500 → 1,271–2,119
  * pro.co.il (incl.): installing a standard 120 cm kalpa, formica front, "without mechanism" 1,500–2,000 → 1,271–1,695
* Derivation: low = 1,500/1.18; high = 2,500/1.18; typical = average of mid-points (1,695 and 1,483 → 1,590).

### `kitchen.drawer.per-unit` — Kitchen drawer (60 cm), installed, per drawer

* Data: unit **unit**, low **200**, typical **400**, high **600** (ILS ex VAT; confidence: medium)
* Covers: מגירת מטבח 60 ס״מ בפורמייקה כולל מסילות/ידית; הטווח התחתון מגירה רגילה, העליון מגירת טריקה שקטה
* Sources: ksd, dco2, bizwar
* Source figures as published:
  * kitchensdesign (EXCL.): standard 60 cm laminate drawer incl. handle 200–600
  * d.co.il (assumed incl.): low drawer 60 cm 250–600 → 212–508; tall drawer 60 cm 350–500 → 297–424 ("not incl. premium hardware")
  * Bizportal 2026-09-15 (assumed incl.): regular drawer ≈200; soft-close drawer 400–600 → 169; 339–508
* Derivation: Range 200–600 ex VAT is the union of the ksd figures (ex VAT) with the converted others; typical 400 = median of source mid-points (360; 400; 424).

### `kitchen.complete.standard.per-kitchen` — Complete standard custom kitchen (cross-check), per kitchen

* Data: unit **kitchen**, low **15255**, typical **31500**, high **38135** (ILS ex VAT; confidence: low)
* Covers: מטבח שלם סטנדרטי (6–8 מ״ר בקירוב) לפי טווחי שוק; בדרך כלל ללא מכשירי חשמל, כיור/ברזים והכנות (הריסה, אינסטלציה, חשמל)
* Sources: container, ksd, akitchen
* Source figures as published:
  * container.org.il (assumed incl.): custom standard kitchen 18,000–28,000 basic / 28,000–40,000 upgraded, for 6–8 running metres → 15,254–33,898
  * kitchensdesign (EXCL.): modern kitchen "all-in" 25,000–38,000
  * akitchen 2026-10-22 (quoting Midrag, assumed incl.): standard kitchen 38,000–45,000 → 32,203–38,136
* Derivation: Sanity-check figure only (not for summing with per-metre rates). low = 18,000/1.18 = 15,254; high = 45,000/1.18 = 38,136; typical = median of the three source mid-points ex VAT (24,576; 31,500; 35,169).

### `kitchen.complete.luxury.per-kitchen` — Complete luxury custom kitchen (cross-check), per kitchen

* Data: unit **kitchen**, low **42375**, typical **84745**, high **127120** (ILS ex VAT; confidence: low)
* Covers: מטבח יוקרה בהתאמה אישית ("ומעלה")
* Sources: lacasa
* Source figures as published:
  * La Casa 2026 (assumed incl.): custom/luxury kitchen 50,000–150,000+ → 42,373–127,119 (also yagel: 50,000–150,000 and more)
* Derivation: Published range kept; typical = mid-point (100,000 → 84,746). Open-ended top ("ומעלה"); single manufacturer source.

### `worktop.quartz.per-m` — Quartz worktop (Caesarstone-type), per running metre

* Data: unit **m**, low **930**, typical **1780**, high **2965** (ILS ex VAT; confidence: medium)
* Covers: משטח אבן קוורץ/קיסר ל-מטר רץ (עומק 65 ס״מ אצל ניר צבי), לפי רוב המקורות כולל חומר, מדידה, ייצור, פתח לכיור והתקנה
* Sources: nirzvi, lacasa, container, akitchen
* Source figures as published:
  * nir-zvi.co.il (assumed incl.): Caesarstone 1,250–2,450 /running m (100/65 cm), incl. material, measuring, fabrication, install → 1,059–2,076
  * La Casa 2026 (assumed incl.): quartz/Kaiser 1,100–2,500 /m → 932–2,119
  * container.org.il (assumed incl.): worktop (marble/quartz/granite) 1,200–3,500 /m → 1,017–2,966
  * akitchen 2026-10-22 (quoting Midrag/Bizportal): quartz worktop 1,500–3,500 /m → 1,271–2,966
  * Seen only in search-engine summaries (Midrag pages blocked to us, not used): Kaiser 1,100–2,650 /m
* Derivation: low = 1,100/1.18 (La Casa); high = 3,500/1.18 = 2,966 (akitchen/Midrag, container); typical = median of mid-points ex VAT (1,525; 1,568; 1,992; 2,119 → 1,780). Price group, thickness and edge profile drive the spread.

### `worktop.porcelain.per-m` — Porcelain-slab worktop, per running metre

* Data: unit **m**, low **1060**, typical **1655**, high **2245** (ILS ex VAT; confidence: low)
* Covers: גרניט פורצלן, מטר רץ 100/65 ס״מ כולל חומר, עבודה, מדידה והתקנה
* Sources: nirzvi
* Source figures as published:
  * nir-zvi.co.il (assumed incl.): porcelain granite 1,250–2,650 /m (100/65) → 1,059–2,246
* Derivation: Published range kept; typical = mid-point (1,950 → 1,653). Single source. Dekton-brand figures were only seen in blocked Midrag pages → not used.

### `worktop.granite.per-m` — Natural granite worktop, per running metre

* Data: unit **m**, low **1100**, typical **1735**, high **2375** (ILS ex VAT; confidence: low)
* Covers: גרניט טבעי, מטר רץ 100/65 ס״מ כולל חומר, עבודה, מדידה והתקנה
* Sources: nirzvi
* Source figures as published:
  * nir-zvi.co.il (assumed incl.): natural granite 1,300–2,800 /m → 1,102–2,373
  * Cross-check: bvn.co.il says granite/Corian "up to 2,500 per m² and above"
* Derivation: Published range kept; typical = mid-point (2,050 → 1,737). Single source.

### `worktop.marble-local.per-m` — Local natural marble worktop, per running metre

* Data: unit **m**, low **1015**, typical **1145**, high **1270** (ILS ex VAT; confidence: low)
* Covers: שיש טבעי מקומי, מטר רץ 100/65 ס״מ כולל חומר, עבודה, מדידה והתקנה
* Sources: nirzvi
* Source figures as published:
  * nir-zvi.co.il (assumed incl.): local natural marble 1,200–1,500 /m → 1,017–1,271
* Derivation: Published range kept; typical = mid-point. Single source.

### `worktop.cutout.sink` — Sink cut-out in engineered-stone worktop (when priced separately)

* Data: unit **unit**, low **680**, typical **720**, high **765** (ILS ex VAT; confidence: low)
* Covers: חיתוך פתח לכיור במשטח אבן מלאכותית (קיסר) כעבודה נפרדת; אצל ניר צבי הפתח לכיור כלול במחיר המטר
* Sources: ynet
* Source figures as published:
  * ynet (undated; assumed incl.): cut for sink in artificial stone 800–900 → 678–763; natural quality stone (granite) 1,000–1,200 → 847–1,017
* Derivation: Published range kept; typical = mid. Natural-stone variant in worktop.cutout.sink.natural-stone.

### `worktop.cutout.sink.natural-stone` — Sink cut-out in natural stone (granite)

* Data: unit **unit**, low **845**, typical **930**, high **1015** (ILS ex VAT; confidence: low)
* Covers: חיתוך פתח לכיור באבן טבעית (גרניט)
* Sources: ynet
* Source figures as published:
  * ynet (undated; assumed incl.): 1,000–1,200 → 847–1,017
* Derivation: Published range kept; typical = mid.

### `worktop.cutout.hob` — Hob cut-out in engineered stone

* Data: unit **unit**, low **425**, typical **465**, high **510** (ILS ex VAT; confidence: low)
* Covers: חיתוך פתח לכיריים במשטח אבן מלאכותית
* Sources: ynet
* Source figures as published:
  * ynet (undated; assumed incl.): cut for hob in artificial stone 500–600 → 424–508; granite/Dekton ≈ +200–300 (700–900 → 593–763)
* Derivation: Published range kept; typical = mid.

### `worktop.cutout.hob.natural-stone` — Hob cut-out in granite / Dekton

* Data: unit **unit**, low **595**, typical **680**, high **765** (ILS ex VAT; confidence: low)
* Covers: חיתוך פתח לכיריים בגרניט / דקטון
* Sources: ynet
* Source figures as published:
  * ynet (undated; assumed incl.): 700–900 → 593–763
* Derivation: Published range kept; typical = mid.

### `wardrobe.per-m2.basic` — Custom wardrobe, basic (melamine / sandwich / laminate-MDF), per m² of front

* Data: unit **m2**, low **510**, typical **1060**, high **1830** (ILS ex VAT; confidence: medium)
* Covers: ארון קיר בהתאמה אישית (מלמין / סנדוויץ׳ / MDF בפורמייקה) למ״ר חזית; ללא הובלה והתקנה לפי חלק מהמקורות; אביזרי פנים נמכרים בנפרד
* Sources: pro, dco, b144, bizwar
* Source figures as published:
  * pro.co.il (incl.): sandwich wardrobe 1,000–1,500 /m²; MDF formica 1,000–1,500 /m² → 847–1,271
  * d.co.il (assumed incl.): sandwich 918–2,160 /m²; MDF formica 864–2,160 /m² → 778–1,831; 732–1,831
  * B144 (assumed incl.): standard wardrobe 1,030–1,400 /m², avg 1,215, excl. delivery & installation → 873–1,186
  * Bizportal 2026-09-15 (assumed incl.): finishing melamine 600–1,200 /m² → 508–1,017; formica 1,300–1,500 → 1,102–1,271
* Derivation: low = 600/1.18 (cheapest finish, melamine, Bizportal); high = 2,160/1.18 = 1,831 (d.co.il upper bound); typical = median of source mid-points ex VAT (763; 1,030; 1,059; 1,059; 1,187; 1,282; 1,305 → 1,059).

### `wardrobe.per-m2.mid` — Custom wardrobe, mid (veneer / baked lacquer), per m² of front

* Data: unit **m2**, low **1100**, typical **1800**, high **2745** (ILS ex VAT; confidence: medium)
* Covers: ארון קיר בציפוי פורניר / צבע בתנור (אפוקסי) למ״ר חזית
* Sources: pro, dco, bizwar
* Source figures as published:
  * pro.co.il (incl.): MDF veneer wardrobe 1,500–2,000 /m² → 1,271–1,695
  * d.co.il (assumed incl.): MDF veneer 1,296–3,240; epoxy 1,728–3,240 /m² → 1,098–2,746; 1,464–2,746
  * Bizportal (assumed incl.): baked paint 1,800–2,200 /m² → 1,525–1,864
* Derivation: low = 1,098 (d.co.il veneer low, ex VAT; pro.co.il 1,271); high = 3,240/1.18 = 2,746; typical = median of mid-points (1,483; 1,695; 1,922; 2,105 … → 1,800).

### `wardrobe.per-m2.premium` — Custom wardrobe, premium (glass / mirror / aluminium), per m² of front

* Data: unit **m2**, low **2120**, typical **2245**, high **2745** (ILS ex VAT; confidence: low)
* Covers: ארון עם שילוב זכוכית / מראה / אלומיניום למ״ר חזית
* Sources: bizwar, dco
* Source figures as published:
  * Bizportal 2026-09-15 (assumed incl.): glass/mirror/aluminium combination 2,500–2,800 /m² → 2,119–2,373
  * d.co.il (assumed incl.): upper end of veneer/epoxy 3,240 /m² → 2,746
* Derivation: low = 2,500/1.18; typical = mid of Bizportal range (2,650/1.18 = 2,246); high = 2,746 (d.co.il upper bound). Thin evidence.

### `wardrobe.per-m2.melamine` — Wardrobe, melamine finish, per m²

* Data: unit **m2**, low **510**, typical **765**, high **1015** (ILS ex VAT; confidence: low)
* Covers: ארון עם ציפוי מלמין בלבד, למ״ר
* Sources: bizwar
* Source figures as published:
  * Bizportal 2026-09-15 (assumed incl.): melamine 600–1,200 /m² → 508–1,017
* Derivation: Published range kept; typical = mid-point.

### `wardrobe.per-m2.solid-pine` — Wardrobe, solid pine, per m²

* Data: unit **m2**, low **930**, typical **1395**, high **1830** (ILS ex VAT; confidence: medium)
* Covers: ארון קיר מעץ אורן מלא למ״ר
* Sources: pro, dco
* Source figures as published:
  * pro.co.il (incl.): solid-wood (pine) wardrobe 1,100–1,800 /m² → 932–1,525
  * d.co.il (assumed incl.): solid pine wardrobe 1,512–2,160 /m² → 1,281–1,831
* Derivation: low = 1,100/1.18; high = 2,160/1.18; typical = average of the two mid-points (1,229 and 1,556).

### `wardrobe.custom.per-m.floor-to-ceiling` — Custom floor-to-ceiling wardrobe, per running metre (starting price)

* Data: unit **m**, low **2965**, typical **3180**, high **3390** (ILS ex VAT; confidence: low)
* Covers: ארון קיר מנגר בהתאמה אישית מרצפה לתקרה, למטר רץ ("מתחיל ב"), לפני ציפויים ותוספות
* Sources: bizwar, slidoor
* Source figures as published:
  * Bizportal 2026-09-15 (assumed incl.): carpenter wardrobe 3,500–4,000 /m, floor to ceiling, "3 m wardrobe starts at 10,500–12,000 before finishes and extras" → 2,966–3,390
  * Slidoor 2026 (assumed incl.): custom wall wardrobe "starts around 3,500–4,000 /m" (same figure, possibly not independent)
* Derivation: Published range kept; typical = mid. Wall-height not stated – for a 3.00 m ceiling use the per-m² keys × (width × height) instead.

### `wardrobe.sliding.premium-percent` — Sliding doors premium over hinged doors

* Data: unit **percent**, low **12**, typical **12**, high **12** (ILS ex VAT; confidence: low)
* Covers: תוספת מחיר לדלתות הזזה לעומת פתיחה רגילה (ארון בקטלוג רשת בינלאומית: 845 מול 945 ₪)
* Sources: bizwar
* Source figures as published:
  * Bizportal 2026-09-15: a 3-door hinged wardrobe 845 vs the same with sliding doors 945 → +12% (ready-made catalogue item, not custom)
* Derivation: Single data point, quoted as published (the ratio is VAT-neutral).

### `wardrobe.mirror-door.premium-percent` — Mirror-door premium

* Data: unit **percent**, low **30**, typical **70**, high **100** (ILS ex VAT; confidence: low)
* Covers: תוספת מחיר לדלתות מראה לעומת דלתות רגילות (מחירי החלפה)
* Sources: bizwar
* Source figures as published:
  * Bizportal 2026-09-15: replacing a pair of regular doors 750–1,000, a pair of mirror doors 1,300–1,500; "a premium of about 70%"
* Derivation: typical = 70 % as stated by the source; low = 1,300/1,000 − 1 = 30 %; high = 1,500/750 − 1 = 100 %. Ratios are VAT-neutral.

### `wardrobe.drawer.soft-close` — Soft-close drawer inside a wardrobe, per drawer

* Data: unit **unit**, low **340**, typical **425**, high **510** (ILS ex VAT; confidence: low)
* Covers: מגירה פנימית בארון בגדים עם טריקה שקטה (מגירה רגילה ללא טריקה שקטה כ-200 ₪ במקור)
* Sources: bizwar
* Source figures as published:
  * Bizportal 2026-09-15 (assumed incl.): regular drawer ≈200; soft-close drawer 400–600 → 339–508
* Derivation: Published range kept; typical = mid.

### `wardrobe.assembly.sliding` — Assembly of a sliding wardrobe, per job

* Data: unit **job**, low **255**, typical **510**, high **765** (ILS ex VAT; confidence: low)
* Covers: הרכבת ארון הזזה (לפי גודל ואופי העבודה)
* Sources: bizwar
* Source figures as published:
  * Bizportal 2026-09-15 (assumed incl.): sliding wardrobe assembly 300–900 → 254–763
* Derivation: Published range kept; typical = mid.

### `walk-in.melamine.per-m2` — Walk-in closet, melamine, shelves + hanging + drawers, per m²

* Data: unit **m2**, low **460**, typical **780**, high **1100** (ILS ex VAT; confidence: low)
* Covers: חדר ארונות במלמין כולל מדפים, תלייה ומגירות, למ״ר
* Sources: dco
* Source figures as published:
  * d.co.il (assumed incl.): walk-in closet melamine 540–1,296 /m² → 458–1,098
* Derivation: Published range kept; typical = mid-point (918 → 778).

### `walk-in.sandwich.per-m2` — Walk-in closet, sandwich panel, per m²

* Data: unit **m2**, low **780**, typical **1165**, high **1555** (ILS ex VAT; confidence: low)
* Covers: חדר ארונות בסנדוויץ׳ כולל מדפים, תלייה ומגירות, למ״ר
* Sources: dco
* Source figures as published:
  * d.co.il (assumed incl.): walk-in closet sandwich 918–1,836 /m² → 778–1,556
* Derivation: Published range kept; typical = mid-point (1,377 → 1,167).

### `vanity.per-m.basic` — Bathroom vanity, laminate sandwich, per metre

* Data: unit **m**, low **915**, typical **1480**, high **2290** (ILS ex VAT; confidence: medium)
* Covers: ארון אמבטיה סנדוויץ׳ בציפוי פורמייקה, למטר אורך
* Sources: pro, dco
* Source figures as published:
  * pro.co.il (incl.): bathroom cabinet sandwich laminate 1,200–2,000 /m → 1,017–1,695
  * d.co.il (assumed incl.): 1,080–2,700 /m → 915–2,288
* Derivation: low = 1,080/1.18; high = 2,700/1.18; typical = average of the two mid-points (1,356 and 1,602).

### `vanity.per-m.premium` — Bathroom vanity, solid wood / lacquered, per metre

* Data: unit **m**, low **1270**, typical **2100**, high **3205** (ILS ex VAT; confidence: medium)
* Covers: ארון אמבטיה מעץ מלא (אורן/אלון) או MDF באפוקסי, למטר אורך
* Sources: pro, dco
* Source figures as published:
  * pro.co.il (incl.): pine/oak sandwich-wood 1,500–2,500 /m → 1,271–2,119
  * d.co.il (assumed incl.): pine 1,620–3,024; oak 1,836–3,456; epoxy 1,728–3,780 /m → 1,373–3,203
* Derivation: low = 1,500/1.18; high = 3,780/1.18; typical = median of mid-points ex VAT (1,695; 1,968; 2,243; 2,334 → 2,100).

### `vanity.per-unit` — Bathroom vanity from a carpenter, per unit

* Data: unit **unit**, low **2120**, typical **4025**, high **5930** (ILS ex VAT; confidence: low)
* Covers: ארון אמבטיה מנגר, ליחידה (תלוי בגודל, חומר ועיצוב)
* Sources: slidoor
* Source figures as published:
  * Slidoor 2026 (assumed incl.): carpenter bathroom cabinet 2,500–7,000 → 2,119–5,932
* Derivation: Published range kept; typical = mid-point (4,750 → 4,025).

### `sideboard.hanging.per-unit-1.8m` — Wall-hung sideboard / TV unit, 1.8 m

* Data: unit **unit**, low **2105**, typical **3340**, high **4575** (ILS ex VAT; confidence: low)
* Covers: מזנון תלוי באורך 1.8 מ׳ (אורן / אלון), מתאים כבסיס להערכת קיר מדיה
* Sources: pro, dco
* Source figures as published:
  * pro.co.il (incl.): hanging solid-wood sideboard 1.8 m 2,500–5,000 → 2,119–4,237
  * d.co.il (assumed incl.): hanging pine 3,240–5,400; hanging oak 2,484–5,400 → 2,746–4,576; 2,105–4,576
* Derivation: low = 2,484/1.18 = 2,105; high = 5,400/1.18 = 4,576; typical = median of mid-points (3,178; 3,340; 3,661).

### `sideboard.standing.per-unit-1.8m` — Free-standing sideboard, 1.8 m

* Data: unit **unit**, low **1465**, typical **3890**, high **5930** (ILS ex VAT; confidence: low)
* Covers: מזנון עומד באורך 1.8 מ׳ (אורן / אלון)
* Sources: pro, dco
* Source figures as published:
  * pro.co.il (incl.): standing solid-wood sideboard 1.8 m 4,000–7,000 → 3,390–5,932
  * d.co.il (assumed incl.): standing pine 1,728–3,240; standing oak 2,700–6,480 → 1,464–2,746; 2,288–5,492
* Derivation: low = 1,728/1.18 = 1,464; high = 7,000/1.18 = 5,932; typical = median of mid-points (2,105; 3,890; 4,661).

### `commode.per-unit` — Bedroom chest of drawers (MDF, up to 5 drawers)

* Data: unit **unit**, low **915**, typical **1750**, high **2540** (ILS ex VAT; confidence: low)
* Covers: קומודה / שידה בחדר שינה מ-MDF עד 5 מגירות
* Sources: pro, dco
* Source figures as published:
  * pro.co.il (incl.): bedroom commode (MDF) 1,500–3,000 → 1,271–2,542
  * d.co.il (assumed incl.): 1,080–2,700 → 915–2,288
* Derivation: low = 1,080/1.18; high = 3,000/1.18; typical = average of mid-points (1,907 and 1,602).

### `bookcase.per-m2` — Solid-wood bookcase, per m² of front

* Data: unit **m2**, low **915**, typical **1420**, high **2290** (ILS ex VAT; confidence: low)
* Covers: ספרייה / ארון ספרים מעץ מלא (אורן / בוק) למ״ר
* Sources: dco
* Source figures as published:
  * d.co.il (assumed incl.): sacred-books cabinet (bookcase) solid pine 1,080–1,620; beech 1,296–2,700 /m² → 915–1,373; 1,098–2,288
* Derivation: low = 1,080/1.18; high = 2,700/1.18; typical = average of the two mid-points (1,144 and 1,693). Proxy for bookshelves; no per-metre shelving price found.

### `material.melamine17.per-sheet` — Melamine board 17 mm, per sheet (uncut)

* Data: unit **sheet**, low **210**, typical **230**, high **245** (ILS ex VAT; confidence: medium)
* Covers: לוח מלמין 17 מ״מ (לבן 250, בגווני עץ 290), ללא חיתוך; גודל לוח לא צוין בדף
* Sources: tsidky
* Source figures as published:
  * Tsidky (INCL. VAT, stated): melamine 17 mm white 250; wood tones 290; melamine 27 mm 410 → 212; 246; 347 ex VAT
* Derivation: low = white, high = wood tones; typical = mid (270 incl. → 229). Sheet size not stated on the page, so no per-m² figure is given. 27 mm sheet = 347 ex VAT.

### `material.birch-ply18.per-sheet` — Birch plywood 18 mm, 244×122 cm sheet

* Data: unit **sheet**, low **240**, typical **265**, high **265** (ILS ex VAT; confidence: medium)
* Covers: לוח ליבנה (בירץ׳) 18 מ״מ גודל 244×122 ס״מ, ללא חיתוך (285 ל-16 מ״מ)
* Sources: tsidky
* Source figures as published:
  * Tsidky (INCL. VAT): birch 18 mm 310; 16 mm 285; 6 mm 175; 4 mm 130 → 263; 242 ex VAT
* Derivation: low = 16 mm sheet (285 incl. → 242), typical = high = 18 mm (310 incl. → 263).

### `material.birch-ply18.per-m2` — Birch plywood 18 mm, per m² (from sheet price)

* Data: unit **m2**, low **88.3**, typical **88.3**, high **88.3** (ILS ex VAT; confidence: medium)
* Covers: ליבנה 18 מ״מ; 263 ₪ ללוח / 2.977 מ״ר
* Sources: tsidky
* Source figures as published:
  * 310 incl. / 1.18 = 262.7 per sheet; sheet 2.44 × 1.22 = 2.977 m² → 88.3
* Derivation: Computed from the sheet price.

### `material.edge-banding.per-m` — Edge banding 1.3 mm, applied, per metre

* Data: unit **m**, low **8.1**, typical **8.1**, high **12.3** (ILS ex VAT; confidence: medium)
* Covers: הדבקת קנט (1.3 מ״מ) למטר רץ – רגיל / רחב (המחיר כפי שמופיע במחירון כהדבקת קנט)
* Sources: tsidky
* Source figures as published:
  * Tsidky (INCL. VAT): standard edge 1.3 mm 9.5 /m; wide edge 14.5 /m → 8.1; 12.3 ex VAT
* Derivation: low = typical = standard edge; high = wide edge.

### `material.sheet-cutting.per-sheet` — Standard cutting of one sheet

* Data: unit **sheet**, low **51**, typical **51**, high **51** (ILS ex VAT; confidence: medium)
* Covers: חיתוך סטנדרטי של לוח (60; חיתוך לוח גב 30)
* Sources: tsidky
* Source figures as published:
  * Tsidky (INCL. VAT): sheet cutting 60; back-panel cutting 30
* Derivation: 60/1.18.

### `hardware.hinge.soft-close` — Blum soft-close hinge (overlay / half / inset), per hinge

* Data: unit **unit**, low **16.7**, typical **22**, high **23.7** (ILS ex VAT; confidence: high)
* Covers: ציר בלום (ישר / כפוף / פנימי) עם בלימה (Blumotion) כולל פחית (תושבת בנפרד); מחיר אתרי פרזול
* Sources: ponyp, gold
* Source figures as published:
  * ponyp.co.il (retail): Blum straight/bent + soft-close + cup 26; inset 28; plain (no soft-close) 16–18
  * gold-pirzul.co.il (retail): Blumotion straight 19.69; bent 26; inset 28 (plain straight 16.81)
  * VAT not stated → assumed incl.: 19.69–28 → 16.7–23.7 ex VAT
* Derivation: low = 19.69/1.18 = 16.7 (gold-pirzul); typical = 26/1.18 = 22.0 (identical at both shops); high = 28/1.18 = 23.7. Mounting plates 4–7 extra (ponyp).

### `hardware.hinge.wide-angle.soft-close` — Blum 155–180° soft-close hinge, per hinge

* Data: unit **unit**, low **40**, typical **43**, high **49** (ILS ex VAT; confidence: medium)
* Covers: ציר 155°–180° (למזווה / דלתות רחבות) עם בולם
* Sources: ponyp, gold
* Source figures as published:
  * ponyp.co.il (retail): 155° pantry + soft-close 51; 180° + soft-close 51; 155° Hettich damper 55
  * gold-pirzul.co.il (retail): Blum 155 insert with damper 47.44; Expando 155 clip + damper 58.27 → 40.2–49.4 ex VAT (assumed incl.)
* Derivation: low = 47.44/1.18; typical = 51/1.18; high = 58.27/1.18.

### `hardware.drawer.soft-close` — Soft-close metal drawer set (mid-market, Domsil VISION 84 mm), per drawer

* Data: unit **unit**, low **165**, typical **187**, high **208** (ILS ex VAT; confidence: low)
* Covers: סט מגירה מתכתית (VISION של דומסיל) בגובה 84 מ״מ – מחיר מבצע 195 / מחיר רגיל 245; אורך המגירה לא צוין בדף
* Sources: ponyp2
* Source figures as published:
  * ponyp.co.il (retail, assumed incl.): VISION metal-side drawer 84 mm: list 245, sale 195; glass-side 84 mm list 284, sale 227 → 165–208 ex VAT (metal)
* Derivation: low = sale price/1.18 = 165; high = list/1.18 = 208; typical = mid. Rounded values in the data file (165 / 187 / 208).

### `hardware.drawer.legrabox` — Blum Legrabox drawer kit, per drawer ("from" prices)

* Data: unit **unit**, low **395**, typical **395**, high **515** (ILS ex VAT; confidence: low)
* Covers: קיט מגירה Blum Legrabox (דופן 90.5 מ״מ "החל מ" 468; דופן גבוהה 177 מ״מ "החל מ" 608), יבוא מקביל
* Sources: gerassi
* Source figures as published:
  * pirzul-gerassi.com (retail, parallel import, assumed incl.): Legrabox M 90.5 mm from 468; Legrabox C 177 mm from 608 → 397; 515 ex VAT
* Derivation: These are "from" prices by length; low = typical = M-height from-price, high = C-height from-price.

### `hardware.sliding-gear.per-door` — Sliding-wardrobe fittings, per door (2-door kit ÷ 2)

* Data: unit **door**, low **110**, typical **110**, high **110** (ILS ex VAT; confidence: low)
* Covers: סט פרזול ל-2 דלתות הזזה (VR02B-102) 260 → 220 ללא מע״מ, כלומר 110 לדלת; ללא פרופילים/מסילות
* Sources: ponyp2
* Source figures as published:
  * ponyp.co.il (retail, assumed incl.): fittings for 2 sliding doors VR02B-102 = 260 → 220 ex VAT; also wheel pair 100; top track alu 200 and bottom track 120 (length not stated)
* Derivation: Single product point: 260/1.18/2 = 110 per door. Range left degenerate.

### `hardware.handle.recessed` — Recessed handle, per piece (catalogue sample)

* Data: unit **unit**, low **11**, typical **60**, high **63** (ILS ex VAT; confidence: low)
* Covers: ידית שקועה/גומחה (קטלוג פוני פרזול, 15 פריטים ראשונים): מחיר מבצע נמוך 13, מחיר רגיל חציוני 71, מקסימום 74
* Sources: ponyp2
* Source figures as published:
  * ponyp.co.il "ידיות שקועות" (retail, assumed incl.): 15 items sampled: list 16 / 19 / 34 / 40 / 53 / 63 / 71×3 / 74×6; lowest sale 13 → 11–63 ex VAT
* Derivation: low = 13/1.18; typical = median list 71/1.18 = 60; high = 74/1.18 = 63. Sample, not a market study.

### `lighting.led.strip.per-m` — LED strip only (24 V, 60 LED/m), per metre

* Data: unit **m**, low **9.5**, typical **10.7**, high **11.8** (ILS ex VAT; confidence: medium)
* Covers: פס לד גמיש 24V 60 לד/מ׳ בלבד (ללא דרייבר ופרופיל); 5 מ׳ ב-55.92 (אתר) / 69.90 (סניף)
* Sources: homecenter
* Source figures as published:
  * Home Center: LED strip 5 m 24VDC 4.8W: website price 55.92, branch price 69.90 → 11.2–14.0 /m incl. → 9.5–11.9 ex VAT (assumed incl.)
* Derivation: low = web price, high = branch price, typical = mid. Driver + aluminium profile price per metre not found.

### `lighting.kitchen-builtin.per-kitchen` — Built-in kitchen lighting, per kitchen

* Data: unit **kitchen**, low **845**, typical **1905**, high **2965** (ILS ex VAT; confidence: low)
* Covers: תאורה מובנית בגוף המטבח (גופי תאורה והפעלה), למטבח
* Sources: container
* Source figures as published:
  * container.org.il 2026 (assumed incl.): built-in lighting 1,000–3,500 per kitchen → 847–2,966
* Derivation: Published range kept; typical = mid-point.

### `hardware.kitchen-fittings-package.per-kitchen` — Hardware package (runners, hinges, soft-close), per kitchen

* Data: unit **kitchen**, low **1270**, typical **2330**, high **3390** (ILS ex VAT; confidence: low)
* Covers: פרזול (מסילות, צירים, טריקה שקטה) למטבח שלם
* Sources: container
* Source figures as published:
  * container.org.il 2026 (assumed incl.): hardware 1,500–4,000 per kitchen → 1,271–3,390
* Derivation: Published range kept; typical = mid-point.

### `labour.installation.kitchen` — Kitchen installation, per job (when not bundled)

* Data: unit **job**, low **1695**, typical **3600**, high **5930** (ILS ex VAT; confidence: low)
* Covers: התקנת מטבח (בהרבה הצעות נגרים כלולה במחיר); ללא חשמל/אינסטלציה
* Sources: bvn, container
* Source figures as published:
  * bvn.co.il (assumed incl.): basic installation 2,000–5,000 → 1,695–4,237 ("many carpenters bake it into the price")
  * container.org.il 2026 (assumed incl.): installation 3,000–7,000 → 2,542–5,932
* Derivation: low = 2,000/1.18; high = 7,000/1.18; typical = average of the mid-points (2,966 and 4,237 → 3,600). A published % of job value was not found.

### `labour.installer.day` — Carpentry installer, per working day

* Data: unit **day**, low **1270**, typical **1270**, high **1695** (ILS ex VAT; confidence: low)
* Covers: מתקין נגרות ליום עבודה (מבוקשים 2,000; מינימום חצי יום ≈ 750)
* Sources: bizwar
* Source figures as published:
  * Bizportal 2026-09-15 (assumed incl.): installer ≈1,500 per day; in-demand installers 2,000; half-day minimum ≈750 → 1,271; 1,695 ex VAT
* Derivation: low = typical = 1,500/1.18; high = 2,000/1.18.

### `labour.dismantle.kitchen` — Dismantling an old kitchen

* Data: unit **job**, low **850**, typical **1800**, high **2630** (ILS ex VAT; confidence: medium)
* Covers: פירוק מטבח ישן (כולל פינוי פסולת וניקוי בסיסי ב-ksd)
* Sources: ksd, dco2, yagel
* Source figures as published:
  * kitchensdesign (EXCL.): complete old-kitchen dismantling incl. waste removal 1,700–1,900
  * d.co.il (assumed incl.): 1,550–3,100 → 1,314–2,627
  * yagel-mitbachim (VAT unstated, assumed incl.): 1,000–2,000 → 847–1,695
* Derivation: low = 1,000/1.18 = 847; high = 3,100/1.18 = 2,627; typical = median of mid-points (1,271; 1,800; 1,971 → 1,800). The "high" is rounded to 2,630.

### `labour.complex-design.premium-percent` — Premium for complex / non-standard solutions

* Data: unit **percent**, low **10**, typical **15**, high **20** (ILS ex VAT; confidence: low)
* Covers: תוספת נגר לפתרונות מורכבים/לא סטנדרטיים (פינות מעוגלות, מידות חריגות)
* Sources: bvn, bizwar
* Source figures as published:
  * bvn.co.il: carpenter adds 10–20% for unique solutions (rounded corner units, non-standard sizes)
  * Bizportal 2026-09-15: planning complexity adds 10–15%
* Derivation: low = 10 (both); high = 20 (bvn); typical = 15 (upper of Bizportal / mid of bvn). Percentages are VAT-neutral.

### `labour.dismantle.old-wardrobe` — Dismantling an old wall wardrobe

* Data: unit **job**, low **380**, typical **380**, high **380** (ILS ex VAT; confidence: low)
* Covers: פירוק ארון קיר ישן (ממוצע)
* Sources: bizwar
* Source figures as published:
  * Bizportal 2026-09-15 (assumed incl.): ≈450 on average → 381
* Derivation: Single average quoted as published.

## Not found (no rate in the data file – do not invent)

* Premium for handle-less / integrated-handle / J-profile fronts; gola / J-profile price per metre; kitchen plinth/legs per metre.
* LED strip complete with driver and aluminium profile per metre (only bare strip found: `lighting.led.strip.per-m`); `lighting.led.per-m` therefore not provided.
* Lift-up mechanism hardware alone (Aventos-type) per unit – only finished lift-up (kalpa) cabinets were found; pull-out pantry mechanisms priced separately.
* Sliding-door price per door / per m² of sliding front (only a 2-door gear kit and a +12 % premium); mirror-door premium is from replacement doors.
* To-ceiling (3.00 m) height premium in percent: `wardrobe.to-ceiling.premium-percent` – only qualitative statements (La Casa); use the per-m² rates × actual height.
* Worktops: solid wood / butcher block, laminate, stainless steel, Dekton as a separate brand; upstand (גב שיש) per metre, polished/double edge, waterfall end, extra thickness, joints. Midrag appears to publish edge prices (350–600 /m) and Dekton prices, but its pages are blocked (below) and only search-engine summaries were available, which were not used as a source.
* Lacquer / veneer sheet material per m²; MFC/MDF 18 mm per m² (the Tsidky page lists melamine 17 mm per sheet without sheet size, so only per-sheet is given); MDF sheet price from Carmi Woods (404 on fetch).
* Media / TV wall per metre, shelving per metre, entry closet and bench, utility / laundry cabinets per metre, desks (only sideboards, bookcase per m², commode available).
* Delivery surcharge for the north / periphery; design / measuring fee (measuring is free at the showrooms that mention it); standard deposit percentage; installation as a percentage of job value (only ILS amounts found).
* Brand-specific Blum Tandembox prices in ILS (Israeli shops show Legrabox "from" prices and Domsil VISION sets only).

## Sites that blocked access (no bypass attempted)

* **midrag.co.il** (Midrag price lists: kitchens per metre, Kaiser, Dekton, wardrobe doors, etc.) – HTTP 405 and an AWS WAF "Human Verification" page for scripted fetches; WebFetch also returned 405. Midrag figures appear here only second-hand through akitchen.co.il, which cites them, and are flagged as such.
* carmi-woods.co.il product page – HTTP 404.

## Other observations

* Cross-check of whole-kitchen totals: container.org.il (6–8 m, standard custom) 18,000–40,000; kitchensdesign "modern all-in" 25,000–38,000 ex VAT; La Casa luxury 50,000–150,000+. Per-metre rates × length should land in this neighbourhood before worktop and appliances.
* The ready-made sliding wardrobe at Home Center (200×240×57 cm, 1,699 sale / 2,222 list, delivery + installation 550 extra) is a catalogue product, not custom carpentry, and was not used.
