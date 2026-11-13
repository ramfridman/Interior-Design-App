# Carpenters directory - sources and method

Data file: `src/carpentry/carpenters.js` (45 entries: 25 own-site, 20 listing-only). See the two kinds below. No ratings, rankings or reviews are included; `specialties` and `notes` restate only what the business publishes about itself.

**Details change. Confirm every phone number, address and opening hour by phone before visiting or relying on an entry.** Several national chains publish one central number (e.g. `*8387`, `*8932`) rather than a branch line.


## Two kinds of entry (`source.kind`)
- **`own-site`** (`listingOnly: false`, 25 entries): every detail was read on 2026-11-13 from the business's own website; `source.url` is the exact page.
- **`directory`** (`listingOnly: true`, `website: null`, 20 entries): small workshops near Afikim (Afikim, Ashdot Ya'akov Ihud, Ein Gev, Kfar HaNasi, Tiberias, Beit She'an, Afula listing, Katzrin, Afik, Ramot, Ilut) that exist only on the Bezeq B144 directory. `source.url` is the B144 listing page fetched on 2026-11-13 (the app should link to it). Name (also copied into `nameHe`), town and any "what they do" text are exactly as listed; no ratings were copied. B144 shows almost all phone numbers only behind a "show number" button or as virtual / call-tracking numbers (07x), so `phone` is `null` and the note says to contact via the directory listing; the one exception is Omri Shadi (visible mobile 054-2150740). Many listings carry only a name, town and the category "נגרים" (carpenters), so `specialties` is empty for them. Directory listings can be stale or closed and are not confirmed by the business; they are the least reliable entries and must be checked by phone. Listings that returned errors, looked like call-centre pages, or were outside about 40 km were dropped (e.g. "Ovi HaKora" Beit She'an listing whose service area is Haifa / Lower Galilee, Yosef Yariv, Bul Etz Tiberias, Beit Zera, Tel Yosef kibbutz office, Izzy Nagarut Katzrin which shares its phone with Etz Bereshit, and a metalwork shop). Duplicate B144 listings of one business were merged to one entry. No listing-only entries were found for Poria, Tzemach, Menahemia, Kfar Tavor or Yavne'el (those pages only returned generic regional results).
- Etz Bereshit (Katzrin) was first seen on B144 and then found to have its own site, so it is an `own-site` entry.

## Search method
- `WebSearch` with Hebrew queries (נגריה / נגר / מטבחים בהתאמה אישית / ארונות הזזה + town or region) for Tiberias, Jordan Valley kibbutzim, Beit She'an, Afula and the Jezreel Valley, Golan, Lower and Upper Galilee, Kiryat Shmona, Haifa bay, Krayot, Karmiel, Nahariya.
- Directory pages (B144, Dapei Zahav, Pro, Rotter, Easy) were used only to learn business names and then locate each business's own website. Their phone numbers (often call-tracking numbers such as 076-...) and listing text were NOT copied into the data.
- Each website was fetched with `curl` (home page plus contact / about / branches pages) and phones, e-mails and addresses were extracted by script and then read by hand. JS-rendered pages (Regba branch list) were read with Playwright.
- A website was used only if the details appeared in the fetched page text. Missing items (e.g. an e-mail hidden by Cloudflare obfuscation, no street address) are `null`.

## Coordinates
`lat` / `lon` are approximate public coordinates of the stated town / city / kibbutz / moshav, from the author's general geographic knowledge, rounded to 2 decimals. They are NOT geocoded street addresses; distance sorting is therefore accurate to a few km only. For branches in an industrial zone, the town's coordinates were used.

## Area coverage and honest gaps
Covered by at least one search: Tiberias, Beit She'an, Afula, Migdal HaEmek, Nof HaGalil, Kfar Tavor, Jordan Valley kibbutzim, Golan / Katzrin, Rosh Pinna / Safed / Kiryat Shmona, Karmiel, Nahariya, Haifa bay. Real small workshops in the Jordan Valley, Tiberias and Beit She'an mostly publish only on directories or Facebook / Instagram, not on their own sites, so they could not be verified under the own-site rule and are missing here. Their B144 listings are now included as flagged listing-only entries (see above). The owner should also ask neighbours at the kibbutz and in the valley for local carpenters. Own-site entries number fewer than the 40-60 target on purpose.

## Entries with caveats
- `dekel-kamila-tiberias`: showroom (Tiberias) with kitchens made at Kibbutz Shiller, per its page. Its site lists the Tiberias number 04-6965584; other Dekel/Kamila sites show national numbers.
- `w-wood-beit-shean`: real Beit She'an-valley workshop, but its products are mostly Montessori / children's furniture, shelves and benches, not kitchens. Include only as a possible contact for small custom pieces.
- `hanagarya-yehuda-abu`: its title describes it as a specialist in interior and exterior doors; kitchens appear only in a customer quote, so kitchens are not listed in `specialties`.
- `sivan-hanagar`: the site says the workshop is located "in Nof HaGalil" and gives no street address (address left `null`).
- `touchwood-yodfat`: the site's history places the carpentry on Moshav Yodfat (Lower Galilee) but does not give a current street address; confirm location by phone. Phone and e-mail from its contact page.
- `grif-carpentry` (Kibbutz Barkai, Menashe area) is outside the northern focus; kept as a custom-kitchen workshop on a kibbutz. `servesNorth` is `null`.
- Chain entries (Regba, Ziv, Semel, Agam, Delkoub, Carmel Aronot, Closets, MM Kitchens, Dekel Kamila) are one record per northern showroom / branch, using the branch address on the chain's own site.
- `zukero-ramat-david`: phone is published as `049530333`; shown as 04-9530333.

## Considered and dropped (reason)
- Avivi Kitchens (avivi-kitchens.co.il): site text gave no branch address or phone.
- Golan Kitchens (golan-kitchens.co.il): site places the workshop at Moshav Horshim (central Israel), not the Golan.
- Hanagaria (hanagaria1.co.il, Moshav Zecharia), Yagel Kitchens (Moshav Yagel), Ayalim Nagarut, Kama Nagarut (Sderot), Pecan, Adi Kitchens (Rosh HaAyin), Adi & Erez (Moshav Nili), Shay-Ke, Zedka, Riviera, Kloss, AZZA: verified as real but located in central / southern Israel or without a northern showroom detail; outside the target area.
- Bavliya (bavliya.com), Vigowood, Eliah / country-kitchen.co.il, Elgalil kitchens, Nagarya.co.il ("Nagarya BeClick", online service): no location stated on their sites.
- Businesses seen only on directories and located outside the nearby area (or without a usable listing) (e.g. Tarek Kitchens Dir Hanna, Wonder Woodland Tiberias, Chir al-Din Tiberias, Omri Shadi and Dar'an carpentries Beit She'an, Etz Bereshit and Izzy Nagarut Katzrin, Etz HaGolan Afula, Paz / Fe'er Kitchens Afula, Amer Nagarut Peki'in, Boutique M.A, Tavor Designs, Nagariat HaOmanim Safed, Ofer Rosh Pinna): no own website found, so not verified; not included. Directory phone numbers are often call-tracking numbers.
- Eli Mizrahi, Panel, Decor, Etz HaZayit, Aviv: no own-site page found via search for a northern showroom.

## Sites that blocked or did not load
- `nagariat-hagolan.com`, `aa-nagarut.co.il`, `prowork.co.il`, `deebkitchens.co.il`, `nagariabkfar.info`, `the-carpenter.co.il`: did not resolve from this environment (DNS / network not allowed).
- `kitchenpt.com`: HTTP 403; `13tv.co.il`: HTTP 403. Skipped, not bypassed.
- Search engines (Bing, DuckDuckGo, Brave, Yandex, Startpage, Mojeek) showed captchas or blocked automated access; they were not used.
