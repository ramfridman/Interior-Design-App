# Regulations & best-practice knowledge base — house E7, lot 98, Kibbutz Afikim

Single-storey detached house (≈ 161–163 m², with a mamad), lot ≈ 500 m², ceiling 3.00 m, flat roof.
This file is the written basis of the automatic checker in `src/regulations/` (`RULES`, `runChecks`).

> **Disclaimer.** This is a design aid, not a legal permit review. The approved building permit, the local plan
> (תב"ע), the Home Front Command approval and the architect and engineer of record always govern.
> Research date: November 2026. Regulations change — re-check before relying on a number.

## 0. How to read this file

| Label | Meaning |
| --- | --- |
| **REGULATION** | Binding Israeli law / regulation. The permit is checked against it. |
| **STANDARD / GUIDELINE** | Israeli Standard (ת"י) or official guidance (Home Front Command, ministry guidelines). Standards become binding where a regulation refers to them. |
| **BEST PRACTICE** | Professional ergonomics (NKBA, Neufert …). Not law. |

**Confidence** — *high*: the number was read in the consolidated text of the regulation during this research;
*medium*: reputable secondary source or a widely used professional guideline; *low*: rule of thumb, or it could not be
confirmed in an authoritative text. Nothing here is invented: where no authoritative number was found, it says so.

### Sources actually read

Consolidated Hebrew texts were read on Hebrew Wikisource (ויקיטקסט, "ספר החוקים הפתוח"), which reproduces the
official gazette (קובץ התקנות) with all amendments and links every amendment to its gazette PDF.

| Key | Regulation (Hebrew — English) | Consolidated text | Gazette |
| --- | --- | --- | --- |
| **PBR** | תקנות התכנון והבניה (בקשה להיתר, תנאיו ואגרות), תש"ל-1970 — Planning & Building Regulations (Permit Application, Conditions and Fees), Second Schedule (התוספת השנייה) | <https://he.wikisource.org/wiki/תקנות_התכנון_והבניה_(בקשה_להיתר,_תנאיו_ואגרות)> | ק"ת תש"ל 1841 — <https://olaw.org.il/takanot/takanot-2581.pdf> |
| **HAGA** | תקנות ההתגוננות האזרחית (מפרטים לבניית מקלטים), התש"ן-1990 — Civil Defence Regulations (Specifications for the Construction of Shelters) | <https://he.wikisource.org/wiki/תקנות_ההתגוננות_האזרחית_(מפרטים_לבניית_מקלטים)> | ק"ת תש"ן 1020 — <https://olaw.org.il/takanot/takanot-5289.pdf> |
| **EXEMPT** | תקנות התכנון והבנייה (עבודות ומבנים הפטורים מהיתר), התשע"ד-2014 — Works and Structures Exempt from a Permit | <https://he.wikisource.org/wiki/תקנות_התכנון_והבנייה_(עבודות_ומבנים_הפטורים_מהיתר)> | ק"ת תשע"ד 1532 — <https://olaw.org.il/takanot/takanot-7400.pdf> |
| **PARK** | תקנות התכנון והבניה (התקנת מקומות חניה), התשמ"ג-1983 — Installation of Parking Places | <https://he.wikisource.org/wiki/תקנות_התכנון_והבניה_(התקנת_מקומות_חניה)> | ק"ת תשמ"ג 1737 — <https://olaw.org.il/takanot/takanot-4513.pdf> |
| **SAFETY** | תקנות התכנון והבנייה (תכן הבנייה) (בטיחות המשתמש), התש"ף-2019 — Building Design (User Safety); in force 1.2.2020 | <https://he.wikisource.org/wiki/תקנות_התכנון_והבנייה_(תכן_הבנייה)_(בטיחות_המשתמש)> | ק"ת תש"ף 78 — <https://olaw.org.il/takanot/takanot-8286.pdf> |
| **SANIT** | תקנות התכנון והבנייה (תכן הבנייה) (תברואה), התש"ף-2019 — Building Design (Sanitation) | <https://he.wikisource.org/wiki/תקנות_התכנון_והבנייה_(תכן_הבנייה)_(תברואה)> | ק"ת תש"ף 48 — <https://olaw.org.il/takanot/takanot-8286.pdf> |
| **GREEN** | תקנות התכנון והבנייה (תכן הבנייה) (בנייה בת-קיימה), התש"ף-2020 — Building Design (Sustainable Building), incl. the 2025 photovoltaic amendments | <https://he.wikisource.org/wiki/תקנות_התכנון_והבנייה_(תכן_הבנייה)_(בנייה_בת-קיימה)> | ק"ת תש"ף 2550 — <https://olaw.org.il/takanot/takanot-8733.pdf> |
| **ELEC** | תקנות החשמל (מעגלים סופיים הניזונים במתח עד 1000 וולט), התשמ"ה-1984 — Electricity Regulations (Final Circuits up to 1000 V) | <https://he.wikisource.org/wiki/תקנות_החשמל_(מעגלים_סופיים_הניזונים_במתח_עד_1000_וולט)> | ק"ת תשמ"ה 350 — <https://olaw.org.il/takanot/takanot-4731.pdf> |
| **NKBA** | NKBA Kitchen Planning Guidelines with Access Standards | <https://kb.nkba.org/uploads/2022/05/Kitchen-Planning-Guidelines.pdf> | — |
| **HFC** | Home Front Command (פיקוד העורף) guidance on everyday use of the mamad — read as quoted by N12 and The Jerusalem Post (oref.org.il refuses automated access) | <https://www.mako.co.il/news-money/real_estate/Article-faf656164ae0b81026.htm> | — |

Israeli Standards (ת"י) are sold by the Standards Institution and are not open-access; their numbers below come from
the regulation that cites them or from secondary sources, and are marked accordingly.

---

## 1. REGULATIONS (mandatory)

### 1.1 Room sizes and heights — PBR, Second Schedule, Part B (חלק ב': גדלם, איוורם ותאורתם של חלקי בנין)

Definitions (PBR reg. 1): *"חדר מגורים" – חדר המיועד למגורים, למעט מטבח, חדר שירות, מסדרון ומרפסת*;
*"חדר שירות" – חדר אמבטיה, בית-שימוש, מזווה או חדר ארונות*.

| Requirement | Number | Section | Confidence |
| --- | --- | --- | --- |
| Habitable room (חדר מגורים): min. area / min. width between walls | **8.0 m² / 2.60 m** | §2.04(א)(1) | high |
| At least one habitable room in a dwelling with ≥ 2 rooms | **12.0 m²** / 2.60 m | §2.04(א)(3) | high |
| Habitable room in a one-room dwelling | 14.0 m² / 2.60 m | §2.04(א)(2) | high |
| Small room (חדרון) | 6.0 m² / 2.00 m | §2.04(א)(4) | high |
| Bathroom (חדר אמבטיה) | **2.5 m² / 1.45 m** | §2.04(א)(5) | high |
| Wash room with shower + toilet (חדר רחצה המכיל מקלחת ואסלה) | **1.8 m² / 0.90 m** | §2.04(א)(10) | high |
| Toilet room (בית שימוש), measured between wall finishes | **1.1 m² / 0.80 m** | §2.04(א)(6) | high |
| Kitchen in a dwelling with ≥ 2 rooms | **6.0 m² / 1.70 m** | §2.04(א)(7) | high |
| Kitchen adjoining a dining area ≥ 4.0 m² | 5.0 m² / 1.70 m | §2.04(א)(9) | high |
| Width is measured 1.20 m above the floor, between finishes; must be kept only over the minimum area | — | §2.04(ב), (ג) | high |
| Height: room used by people (חדר המשמש לשהייה של בני אדם) | **2.50 m** | §2.03(א)(4) | high |
| Height: service room, internal corridor, non-habitable space | **2.05 m** | §2.03(א)(3) | high |
| Height: shelter (מקלט או מחסה) / parking | 2.00 m / 2.05 m | §2.03(א)(2), (11) | high |
| Head room in escape routes | 2.20 m (fixtures to 2.00 m; in a dwelling the Part B heights apply) | Part C §3.1.2.5, §3.8.2.2 | high |
| Laundry / utility room | no statutory minimum area (not a defined room type) | reg. 1 | medium |

### 1.2 Daylight and ventilation — PBR Part B, signs ג'–ו'

"Window" (חלון) includes a glazed door (*"לרבות אשנב, דלת מזוגגת או פתח אחר"*, §2.01); "window area" is the structural
opening.

| Requirement | Number | Section | Confidence |
| --- | --- | --- | --- |
| Habitable rooms and kitchens must have windows to the open air | — | §2.20 | high |
| Windows of a habitable room | **≥ 8 % of floor area** | §2.21(א) | high |
| Windows of a kitchen | **≥ 5 % of floor area** | §2.21(ב) | high |
| Windows of a service room (bath, WC; not a closet room) | **≥ 10 % of floor area and ≥ 0.3 m²** | §2.21(ג) | high |
| Window opening onto a balcony when it is the only window | 8 % (5 %) of room floor **plus ⅛ of the balcony strip** in front | §2.22 | high |
| No window in a wall on a side or rear lot boundary | — | §2.23 | high |
| Service room may instead be ventilated by a vent in the door (≥ 0.3 m², translucent), a vent duct (≥ 140 cm²), or a mechanical extractor | — | §2.40–2.46 | high |
| Mechanical ventilation rate: habitable room, dwelling kitchen, dwelling service room | **3 air changes / hour** | §2.61 | high |
| Artificial light in a service room without daylight | 100 lux at 75 cm | §2.80 | high |

The regulations do **not** state an "openable fraction" of the window for a dwelling; the 8 % is the opening size.
(Claims of "half the window must open" were not found in the text — confidence that no such number exists: medium.)

### 1.3 Doors, corridors, fire safety — PBR Part C (חלק ג' – בטיחות אש בבניינים)

| Requirement | Number | Section | Confidence |
| --- | --- | --- | --- |
| Dwelling exit door — clear width | **0.80 m** | §3.2.1.3 table, row 2 | high |
| Door of a habitable room in a dwelling | **0.70 m** | row 4 | high |
| Door of at least one service room with a toilet | **0.70 m** | row 5 | high |
| Door of additional service rooms | **0.60 m** | row 6 | high |
| Mamad door | "per Home Front Command instructions" | row 25 | high |
| Clear door height | **1.98 m** | §3.2.1.4 | high |
| Corridor in a dwelling / corridor serving as the main entrance | **0.90 m / 1.00 m** | §3.2.12.5 table rows 1–2 | high |
| A sliding door may be used in a dwelling but not as the main entrance, nor in an escape corridor | — | §3.8.4.2 | high |
| Bathroom / WC lock must be openable from outside in an emergency | — | §3.8.4.4 | high |
| Threshold at the dwelling entrance ≤ 20 mm; step to a balcony / yard ≤ 200 mm | — | §3.8.4.5 | high |
| Stand-alone smoke detector (ת"י 1220 חלק 5) in every bedroom, in the lobby to the bedrooms, on every storey without bedrooms — building with up to 2 dwellings | — | ch. ד' sign י"א, residential table row (1); §3.4.6.2 | high |
| Single-family house: signs כ'–כ"ד and כ"ט of the residential chapter do not apply (no fire-brigade access road, sprinklers, etc.) | — | §3.8.2.3 | high |
| Entrance door security (steel door, multi-point lock) | detailed spec | Part B sign ז', §2.90–2.92 | high |

### 1.4 Fall protection, glazing, user safety — SAFETY regulations (replaced PBR Part B sign ח' in 2020)

| Requirement | Section | Confidence |
| --- | --- | --- |
| Guard to **ת"י 1142** at every balcony, at any wall opening with a risk of falling, and wherever two adjacent levels differ by **≥ 60 cm** | reg. 4(א), 7 | high |
| Outside the building, level differences ≥ 60 cm follow **ת"י 2142** | reg. 4(ב) | high |
| Flat roof reached by stairs needs a guard; otherwise an anchor point (20 kN) near the roof access | reg. 5 | high |
| Glazing must comply with **ת"י 1099** part 1.1 | reg. 9 | high |
| Window bars, if fitted, to **ת"י 1635**, with an escape opening | reg. 11; EXEMPT reg. 17 | high |
| Hot building components (> 55 °C) must be guarded or above 2.05 m | reg. 13 | high |
| Floor slip resistance per **ת"י 2279** | reg. 14 | high |
| Balconies up to 4 m above ground must have lighting switched from inside | reg. 16(ד) | high |
| ת"י 1142 numbers: guard height **1.05 m** (0.90 m along stairs), gaps **≤ 10 cm**, no climbable members | secondary source only (standard not open-access) | **medium** |

For E7 the floor is 15 cm above the garden (assumed), so no window is at a 60 cm drop and no window guard is required.

### 1.5 The mamad (ממ"ד — מרחב מוגן דירתי) — HAGA regulations, Part ג', ch. ג'

| Requirement | Number | Reg. | Confidence |
| --- | --- | --- | --- |
| Net floor area (walls excluded) / volume | **≥ 9 m² / ≥ 22.5 m³** (authority may approve down to 5 m² / 12.5 m³) | 197א(1) | high |
| Clear height | **2.50–2.80 m** unless the competent authority approves otherwise | 198(א) | high |
| Width | **≥ 1.60 m** | 198(ב) | high |
| May not be a kitchen, bathroom or toilet | — | 199 | high |
| External walls | **≤ 2** without approval | 200 | high |
| Door: gas-tight blast door from inside the dwelling, **opening outwards** | — | 202(א), 204(א) | high |
| Door clear opening | **min 70 × 200, max 80 × 200 cm**; 80–90 × 200 when a concrete wall faces it within 1.30 m (wheelchair turning space 1.10 m) | 204(ב), (ב1), 202(ב) | high |
| Door position | internal wall, **≥ 4.00 m** from the parallel external wall facing it, **≥ 2.20 m** from a perpendicular external wall — or shielded per the HFC spec | 203 | high |
| Window: exactly one blast window; sill | **≥ 1.05 m** | 205 | high |
| Window size | **area ≤ 1.21 m²; width 0.60–1.10 m; height 0.80–1.10 m**; inner gas-tight window + outer blast shutter | 206 | high |
| Walls (reinforced concrete): external / internal / wall with a sliding blast window | **≥ 25 cm / ≥ 20 cm / ≥ 30 cm** | 208(א)–(ב) | high |
| Floor and ceiling slabs | ≥ 15 cm (20 cm top / bottom of the tower) | 208(ד) | high |
| Finishes: walls and ceiling smooth concrete with plaster / paint ≤ 2 mm or an ת"י 5075 system; **no ceramic or other tiles on walls and ceiling**; floor tiles and a skirting ≤ 10 cm allowed | — | 192(א)–(ב), 193 via 217 | high |
| Ventilation: filtration system (ת"י 4570), two 4" pipes, 8" sleeve for central AC, sealed sleeve for a split AC | — | 214 | high |
| ≥ 3 sockets, one within 1 m of the air inlet pipe | — | 215 | high |
| LPG cylinders | **≥ 3 m** from the mamad walls | 217א | high |
| No gas pipes in mamad walls | — | PBR §20.07 | high |
| AC in a mamad installed per **ת"י 994 חלק 5** | — | EXEMPT reg. 19(4) | high |

### 1.6 Parking — PARK regulations

| Requirement | Number | Section | Confidence |
| --- | --- | --- | --- |
| Detached / semi-detached house in a settlement **without** mass transit | **2 places per dwelling (minimum)** | Schedule Part B, table 1 row 1.1 | high |
| Same, near mass transit (zones א'–ב') | 1–2 per dwelling (range) | same | high |
| EV-charging infrastructure | only for new multi-family buildings (בנייה רוויה) | reg. 7א | high |

### 1.7 Building lines and what may stand in the setback — PBR Part D (חלק ד')

Building lines (קווי בניין) are set by the local detailed plan (תב"ע); on lot 98 the site plan writes **4.00 m west,
3.00 m north, east and south**. Part D applies unless the plan says otherwise (§4.02).

| Allowed in the setback (מרווח) | Limit | Section | Confidence |
| --- | --- | --- | --- |
| Fence | **≤ 1.5 m** above the highest adjoining ground (residential) | §4.09(1) | high |
| Retaining wall (+ fence on it) | ≤ 3 m combined, stepped above that | §4.09(2) | high |
| Bins, AC units and their acoustic screens, electricity / comms cabinets, gas cylinders, service installations | **≤ 1.5 m high** | §4.09(5) | high |
| Paths, paving, ramps, **paved parking and its access** | — | §4.09(7) | high |
| Uncovered steps / ramps | ≤ 1.5 m | §4.09(9)–(10) | high |
| **Pergola of light materials** projecting beyond the building line | **up to 40 % of the setback** | §4.09(12) | high |
| Projections from the building: cornice, roof overhang, gutter | 0.75 m, ≥ 2.4 m above ground | §4.03 row 1 | high |
| Canopy over an entrance | up to 3.0 m (≥ 1.5 m from the side boundary) | §4.03 row 5, §4.08 | high |

### 1.8 Works exempt from a permit — EXEMPT regulations

General conditions (reg. 2): done by the right-holder, structurally safe, per the Second Schedule, **consistent with
the local plan and spatial guidelines (הנחיות מרחביות)**, not a conservation site.

| Work | Conditions | Reg. | Confidence |
| --- | --- | --- | --- |
| **Fence / retaining wall** | fence ≤ **1.5 m** on both sides; retaining wall ≤ **1 m**; **not on the street front** or facing public open space; steel fences per ת"י 4273 | 5 | high |
| **Gate / barrier** | inside the lot, may not project beyond it when open | 10 | high |
| **Canopy / awning attached to the house** | projects ≤ **2 m**, light materials; > 20 m² → notify + engineer | 11(א), (ד) | high |
| **Shade sail** (fabric) | height ≤ **3 m**, post spacing ≤ **5 m**, ≤ 3.5 kg/m² | 11(ג) | high |
| **Pergola (מצללה)** | definition: no walls, light materials (≤ 50 kg/m²), roof gaps evenly spaced and **≥ 40 % open** (a transparent cover is allowed); area ≤ **50 m² or ¼ of the unbuilt ground / roof, whichever is larger**; on the ground or roof; **notify within 45 days with a structural engineer's approval** | 1, 12 | high |
| **Shed (מחסן)** | **one per dwelling**; light materials; ≤ **6 m²**; ≤ **2.05 m** high (**2.40 m** with a pitched roof); no water / sewer / electricity; not on designated parking, not on an open front balcony; notify within 45 days | 29 | high |
| Solar water heater / boiler | tank ≤ 220 L, at the place set in the permit | 18 | high |
| Air conditioner | ≤ 60,000 BTU, noise regulations, hidden where the permit says; not on a street-facing wall | 19 | high |
| Rooftop photovoltaic | per ת"י 62548, ≤ 700 kW, within the roof outline; notify + electrician + engineer | 24 | high |
| Temporary structure (tent, container) | ≤ 120 days / year, ≤ 50 m² | 25 | high |
| Paving, rockery, landscaping | walls / rockeries ≤ **1 m**, drainage unharmed | 31 | high |
| Window bars | per ת"י 1635 with an escape opening; notify | 17 | high |

A gazebo, carport or any solid-roofed structure on posts is **not** a pergola → building permit, counts as built
area, must respect the building line.

### 1.9 Swimming pools — PBR Part 21 (חלק כ"א)

"Private pool" = serves up to four dwellings (§21.1.1.1). Part 21 does not apply to it, **except** (§21.1.4.6):

* depth > 60 cm and area **< 10 m²** → the **lot must be enclosed** so that no uncontrolled entry is possible;
* depth > 60 cm and area **> 10 m²** → safe construction, steps or ladder, anti-backflow valve, circulation and
  disinfection, a separate place for chemicals, and **barriers around the pool, the plant and the chemicals preventing
  uncontrolled entry "ובכלל זה ילדים ופעוטות"** (§21.1.4.6(10)).

The regulation gives **no fence height for a private pool**; the **1.1 m** stable fence is written for public pools
(§21.1.3.4). Using 1.10 m (≥ the 1.05 m of ת"י 1142) with a self-closing gate is the prudent minimum. A pool is not
an exempt work — it needs a permit. Confidence: high (text), medium (recommended height).

### 1.10 Hot water, solar and photovoltaics

| Requirement | Section | Confidence |
| --- | --- | --- |
| Hot water to kitchen sinks, basins (not the guest-WC basin), showers, baths | SANIT reg. 10(א) | high |
| Storage ≥ 60 °C, outlet ≤ 55 °C | SANIT reg. 11 | high |
| Residential building: hot water by a **solar system (ת"י 579)**, heat pump or an equivalent system, **and** a renewable-energy system (≥ 2,206 kWh / dwelling / year) — one system may serve both | SANIT reg. 24 | high |
| **Ground-attached dwelling with a roof > 100 m²: photovoltaic system of 5 kVA** (engineer may exempt for shading, architecture, roof use, structure) | GREEN reg. 8א(א)(2), 8ב(א)(2), 8ג | medium (text read; commencement date of the 2025 amendment for this permit not verified) |
| Green-building standard ת"י 5281 | mandatory only for multi-storey / multi-family housing and large non-residential buildings — **not for a detached house** | GREEN reg. 2 | high |

### 1.11 Gas — PBR Part 20

LPG installation per **ת"י 158**; no gas appliances in a space below ground level (§20.01); concealed but accessible
piping (§20.06); no gas pipes in shelter walls (§20.07); cylinders in the setback ≤ 1.5 m high (Part D §4.09(5));
≥ 3 m from the mamad (HAGA 217א). Exact ת"י 158 distances from openings and ignition sources were **not confirmed**
(standard not open-access) — leave the cylinder position to the licensed gas installer.

### 1.12 Electricity in bathrooms — ELEC regulations

Zones (reg. 1): **0** inside the bath / shower tray; **1** above it (or 60 cm around a shower head) to the ceiling;
**2** the next **60 cm** horizontally, to 2.25 m high; **3** the next **2.40 m**.

| Rule | Reg. | Confidence |
| --- | --- | --- |
| No electrical equipment in zone 0; IPX5 in zone 1, IPX4 in zone 2, IPX1 in zone 3 | 19(א)–(ב) | high |
| **No sockets in zones 1–2**; in zone 3 only via an isolating transformer or a **30 mA** residual-current device | 19(ה) | high |
| No switches in zones 1–3 except pull-cord switches | 19(ד) | high |
| Heater in a bathroom: switch outside the room by the door | 34 | high |
| Washing machine: dedicated 16 A socket near its tap | 11(ד) | high |
| Sockets ≥ 25 cm above the floor | 18(א) | high |

---

## 2. STANDARDS that do **not** apply (or were not confirmed) for a private house

| Topic | Status |
| --- | --- |
| **Accessibility** (PBR Part ח'1 ch. ב', ת"י 1918) | Applies to residential buildings with **6 or more dwellings** sharing an entrance (§8.250). **Not required** for a detached house. The 90 cm doors on the plan already allow a wheelchair. |
| **ת"י 2142** (level differences outdoors) | Applies in the garden wherever a level difference ≥ 60 cm is created (SAFETY reg. 4(ב)). |
| **ת"י 5281** green building | Voluntary for a detached house (see 1.10). |
| **ת"י 1045** thermal insulation | An official standard checked in the permit's thermal report. No reference was found in the consolidated regulation texts read here; U-values per climate zone were **not verified** — *low confidence*, not checked by the app. Guide: <https://www.gov.il/BlobFolder/guide/building/he/is_1045.pdf>. |
| **ת"י 1205** plumbing | Binding through SANIT reg. 57. **Fixture-to-fixture clearances could not be confirmed** in an open source; the checker uses NKBA / IRC values as best practice. |
| **Parking bay 2.50 × 5.00 m** | The size drawn on the site plan and the usual figure of the Ministry of Transport "הנחיות לתכנון חניה"; the guideline text could not be read (PDF not machine-readable) — *medium*. |
| **Tree felling** | Cutting or moving a mature tree needs a licence from the forest officer (פקודת היערות) — not re-verified here, *low*; relevant only if existing trees stand on the lot. |

---

## 3. GUIDELINES — Home Front Command (פיקוד העורף) on furnishing the mamad

Quoted by N12 (link in the sources table) from the Home Front Command:

> "אם קיימים בממ"ד ארונות ומדפים, יש לקבע אותם לקירות. אין לאחסן בממ"ד חומרים דליקים, מסוכנים ורעילים, ואין לתלות פריטי
> זכוכית או קרמיקה שעלולים להתנפץ כמו מראות. אם קיימים בממ"ד ארונות, יש לקבע אותם לקירות הבטון על ידי מיתדים (דיבלים)"

The same article adds: place heavy objects low, lock cabinet doors if possible, mount a TV on an **internal** wall,
any light fitting is allowed but "רצוי לא נברשות או גופי כבדים"; do not dismantle the door or window; the HFC forbids
using the room as kitchen / WC / bathroom and recommends using it as a bedroom, guest room or study. The Jerusalem Post
(16.2.2024) reports the same: no mirrors or ceramics on the walls, no heavy lampshades, nothing heavy on the wall.

| Guidance used by the checker | Confidence |
| --- | --- |
| Anchor cabinets / shelves to the concrete walls; heavy items low | medium |
| No glass, mirrors or ceramics hung in the mamad | medium |
| TV on an internal wall; no chandeliers / heavy fittings | medium |
| Nothing heavy or breakable above a bed (derived from the above) | medium |
| Keep the blast door's swing and the window free so both close in seconds; never remove them | medium |

What is **regulation** in the mamad (finishes, gas, AC sleeves, use) is in § 1.5.

---

## 4. BEST PRACTICE — interior ergonomics

Numbers from the NKBA Kitchen Planning Guidelines were read in the PDF (*high*). Neufert (*Architects' Data*) and
Panero & Zelnik (*Human Dimension & Interior Space*) are standard references quoted from professional practice
(*medium*). They are advice, not law.

| Topic | Recommendation | Source | Confidence |
| --- | --- | --- | --- |
| Circulation | main routes 80–90 cm (NKBA walkway ≥ 36 in / 91 cm); 60 cm absolute minimum | NKBA G7; Neufert | medium |
| Bed | ≥ 60 cm on each accessible side (both sides of a double), 75–90 cm comfortable | Neufert | medium |
| Wardrobe | 80–90 cm in front for hinged doors; 60 cm bare minimum | Neufert | medium |
| Dining | 81 cm (32 in) table edge to wall with no traffic; 91 cm to edge past; 112 cm to walk past → checker: warn < 75, note < 90 | NKBA G8 | high |
| Kitchen work aisle | ≥ 107 cm (42 in) one cook, ≥ 122 cm (48 in) two cooks; 100–120 cm usual; 90 cm minimum | NKBA G6 | high |
| Work triangle | each leg 1.2–2.7 m, sum ≤ 7.9 m, measured from the centre-front of sink, cooktop, fridge | NKBA G5 | high |
| Island seating | 61 cm (24 in) wide per seat; knee space 46 cm at 76 cm table height, **38 cm at a 91 cm counter**, 30 cm at a 107 cm bar | NKBA G9 | high |
| Sofa – coffee table | 40–45 cm (30–60 acceptable) | interior-design practice | medium |
| TV | 1.2–1.6 × diagonal for 4K (THX 40° / SMPTE 30°), up to 2.5 ×; screen centre ≈ seated eye height (1.05–1.15 m) | SMPTE EG-18 / THX | medium |
| Toilet | centre line ≥ 38 cm (15 in) to a side obstruction, 46 cm recommended; ≥ 53 cm (21 in) in front, 76 cm recommended | IRC R307.1 / NKBA bath guidelines | medium |
| Basin | ≥ 53 cm in front (76 cm recommended); centre line ≥ 38 cm (51 cm recommended) from a wall | same | medium |
| Shower | ≥ 76 × 76 cm inside (91 × 91 recommended); 60 cm clear in front of the entry | same | medium |
| Desk | ≥ 90 cm behind the working edge for the chair (75 cm minimum); desk depth 60–80 cm | Neufert | medium |
| Door swings | nothing inside the arc; 60 cm clear on both sides of a doorway | Neufert | medium |
| Windows | no furniture taller than the sill in front | practice | medium |
| Rugs | dining rug ≥ 60 cm beyond the table on every side; thin rugs under door swings | practice | low |
| Pendants | bottom 75–90 cm above a table top; ≥ 2.00–2.10 m head room in walkways | American Lighting Association practice; PBR §3.1.2.5 (2.00 m under fixtures) | medium |
| Ceiling fan | blades ≥ 2.30 m above the floor (appliance standard IEC 60335-2-80 / ת"י 900-2.80 installation instructions), 45–60 cm from walls | standard quoted from memory of its text | medium |

## 5. BEST PRACTICE — garden

| Topic | Recommendation | Source | Confidence |
| --- | --- | --- | --- |
| BBQ | ≥ 1 m, preferably 3 m, from the house, openings, fences and plants; never under a pergola or parasol | manufacturers' instructions; NFPA 1 §10.10.6 (3 m, multi-family) — no Israeli rule for a private garden was found | low |
| Fire pit | 3 m from structures and canopies | same | low |
| Trees | large-canopy / aggressive-root species (ficus, eucalyptus, poinciana, jacaranda, mango, avocado) 6–8 m from the house and 4 m from the boundary; medium (olive, fig, palm) 4 m / 2 m; small (citrus, pomegranate) 2.5 m / 1.5 m | arboricultural rule of thumb (cf. NHBC Standards 4.2); no Israeli statutory distance was found | low |
| Pool | ≥ 1 m from the house and boundary, inside the building lines unless the local plan differs | local spatial guidelines — **not verified for Emek HaYarden** | low |
| Planting | group plants by water need (hydrozones): lawn and tropical plants apart from succulents, lavender, rosemary, olive, bougainvillea; limit lawn | water-wise gardening practice (Israel Water Authority) | low |
| Parking | keep both required bays free | EXEMPT reg. 29(4) (no shed on designated parking) | high |
| Entry path | ≥ 90 cm clear from the street to the door | Neufert | medium |

---

## 6. What the checker finds on the real plan (lot 98) and the architect's layout

Run `node tests/regulations.test.mjs` for the full report (102 findings: 82 pass, 16 notes, 4 warnings, 0 failures).

**Passes worth knowing:** all room areas and widths; ceiling 3.00 m; light ratios (bedrooms 13.0 %, master 12.8 %,
living space 18.0 %, mamad 9.5 %); all doors; corridor 1.10 m; mamad 10.5 m² / 31.5 m³, door 80 × 200 outwards,
window 100 × 100 at +110, walls 20 / 25 / 30 / 20 cm, one external wall, door 8.3 m from the facing external wall;
2 parking bays of 2.50 × 5.00 m; setbacks W 6.05 / N 3.08 / E 3.49 / S 3.10 m; house inside the building line.

**Warnings**

1. **Mamad height.** The ceiling is 3.00 m but HAGA reg. 198 limits a mamad to 2.80 m unless the Home Front Command
   approves — confirm whether the mamad has its own lower slab or an approval.
2. **Family bathroom window** 0.80 × 0.70 = 0.56 m² is less than 10 % of the 6.60 m² floor (0.66 m²) → a mechanical
   extractor is required (permitted by §2.40–2.47).
3. **Guest WC window** 0.40 × 0.60 (height assumed) = 0.24 m² < 0.30 m² → extractor, or a taller window (≥ 75 cm).
4. **Dining table** as drawn stands 50 cm from the corridor wall on its south side — the three chairs there cannot be
   pulled out (75–90 cm needed).

**Notes:** laundry room has no window; glazed terrace door needs safety glass; smoke detectors; the mamad's west wall is
typed as an ordinary partition in the plan data; anchor the mamad wardrobe; utility yard lies 1.90 m beyond the
building line (acceptable only as open, low paving / service area); 5 island stools at 56 cm each and a 30 cm
overhang; work triangle 9.6 m; cooktop under the north window; master wardrobe has 75 cm in front; PV / solar reminder;
five open drawing assumptions.

## 7. How the checker uses this

`RULES` in `src/regulations/rules.js` carries, for every rule, `kind`, `requirement`, `reference { name, section, url }`
and `confidence` exactly as above. `runChecks({ store, plan, catalog })` computes every figure from `plan` and
`store.items` (nothing about the house is hard-coded), returns passing checks too, and tags each finding with
`spaceId` / `itemIds` / `at`. Routes are measured on a 5 cm grid (± 5 cm). When a regulation changes, update the number
here and in `rules.js` together.
