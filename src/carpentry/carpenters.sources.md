# Carpenters directory - sources and method

Data file: `src/carpentry/carpenters.js` (24 entries). All details were read on 2026-11-13 from each business's own website (the exact page is in each entry's `source.url`). No ratings, rankings or reviews are included; `specialties` and `notes` restate only what the business publishes about itself.

**Details change. Confirm every phone number, address and opening hour by phone before visiting or relying on an entry.** Several national chains publish one central number (e.g. `*8387`, `*8932`) rather than a branch line.

## Search method
- `WebSearch` with Hebrew queries (נגריה / נגר / מטבחים בהתאמה אישית / ארונות הזזה + town or region) for Tiberias, Jordan Valley kibbutzim, Beit She'an, Afula and the Jezreel Valley, Golan, Lower and Upper Galilee, Kiryat Shmona, Haifa bay, Krayot, Karmiel, Nahariya.
- Directory pages (B144, Dapei Zahav, Pro, Rotter, Easy) were used only to learn business names and then locate each business's own website. Their phone numbers (often call-tracking numbers such as 076-...) and listing text were NOT copied into the data.
- Each website was fetched with `curl` (home page plus contact / about / branches pages) and phones, e-mails and addresses were extracted by script and then read by hand. JS-rendered pages (Regba branch list) were read with Playwright.
- A website was used only if the details appeared in the fetched page text. Missing items (e.g. an e-mail hidden by Cloudflare obfuscation, no street address) are `null`.

## Coordinates
`lat` / `lon` are approximate public coordinates of the stated town / city / kibbutz / moshav, from the author's general geographic knowledge, rounded to 2 decimals. They are NOT geocoded street addresses; distance sorting is therefore accurate to a few km only. For branches in an industrial zone, the town's coordinates were used.

## Area coverage and honest gaps
Covered by at least one search: Tiberias, Beit She'an, Afula, Migdal HaEmek, Nof HaGalil, Kfar Tavor, Jordan Valley kibbutzim, Golan / Katzrin, Rosh Pinna / Safed / Kiryat Shmona, Karmiel, Nahariya, Haifa bay. Real small workshops in the Jordan Valley, Tiberias and Beit She'an mostly publish only on directories or Facebook / Instagram, not on their own sites, so they could not be verified under the own-site rule and are missing here. Entries nearest Afikim are therefore few; the owner should also ask neighbours at the kibbutz and in the valley for local carpenters. Fewer than the 40-60 target were included on purpose.

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
- Businesses seen only on directories (e.g. Tarek Kitchens Dir Hanna, Wonder Woodland Tiberias, Chir al-Din Tiberias, Omri Shadi and Dar'an carpentries Beit She'an, Etz Bereshit and Izzy Nagarut Katzrin, Etz HaGolan Afula, Paz / Fe'er Kitchens Afula, Amer Nagarut Peki'in, Boutique M.A, Tavor Designs, Nagariat HaOmanim Safed, Ofer Rosh Pinna): no own website found, so not verified; not included. Directory phone numbers are often call-tracking numbers.
- Eli Mizrahi, Panel, Decor, Etz HaZayit, Aviv: no own-site page found via search for a northern showroom.

## Sites that blocked or did not load
- `nagariat-hagolan.com`, `aa-nagarut.co.il`, `prowork.co.il`, `deebkitchens.co.il`, `nagariabkfar.info`, `the-carpenter.co.il`: did not resolve from this environment (DNS / network not allowed).
- `kitchenpt.com`: HTTP 403; `13tv.co.il`: HTTP 403. Skipped, not bypassed.
- Search engines (Bing, DuckDuckGo, Brave, Yandex, Startpage, Mojeek) showed captchas or blocked automated access; they were not used.
