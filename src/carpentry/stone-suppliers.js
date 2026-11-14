// Real worktop-stone suppliers in Israel (brand houses, importers / stone yards, fabricators), read on 2026-11-14.
// Facts come from each business's own page (ownSite: true) or, for fabricators with no site of their own, from the d.co.il directory listing (ownSite: false, listingOnly: true).
// Coordinates are approximate town centres (coordsNote: 'town-centre'). Ratings only where a page showed one. Confirm by phone before relying on details (see stones.sources.md).
export const STONE_SUPPLIERS = [
  {
    id: "caesarstone-israel",
    name: "Caesarstone Israel",
    nameHe: "אבן קיסר",
    kind: "brand",
    offers: ["quartz", "porcelain", "fusion"],
    services: ["showroom", "sample-ordering", "fabricator-training"],
    city: "Bnei Brak",
    cityHe: "בני ברק",
    region: "Center",
    lat: 32.08,
    lon: 34.83,
    coordsNote: "town-centre",
    address: "Lehi 37, Bnei Brak (Concept House); also Concept House at Globus Center, Ashkelon",
    addressHe: "לח\"י 37, בני ברק (קונספט האוס); וכן גלובוס סנטר, אשקלון",
    phone: null,
    website: "https://www.caesarstone.co.il/",
    sources: [
      {
        url: "https://www.caesarstone.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://www.caesarstone.co.il/concept_house_direct_sale/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://www.caesarstone.co.il/design-and-specification/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://mos.caesarstone.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Manufacturer brand house. The Israeli site lists 103 designs, a where-to-buy store locator (JavaScript, not readable here), two Concept House showrooms (Bnei Brak, Ashkelon) and a Master of Stone training platform for fabricators. No phone on the pages read."
  },
  {
    id: "nir-zvi-marble",
    name: "Nir Zvi Marble",
    nameHe: "שיש ניר צבי",
    kind: "fabricator",
    offers: ["marble", "granite", "quartzite", "onyx", "quartz", "porcelain", "sintered"],
    services: ["showroom", "measure", "fabricate", "install", "import"],
    city: "Rehovot",
    cityHe: "רחובות",
    region: "Center",
    lat: 31.89,
    lon: 34.81,
    coordsNote: "town-centre",
    address: "Showroom: 27 Herzl St., Rehovot. Factory: 15 Shlomo HaMelech St., Ramla",
    addressHe: "אולם תצוגה: הרצל 27, רחובות. מפעל: שלמה המלך 15, רמלה",
    phone: "08-9494100",
    website: "https://nir-zvi.co.il/",
    sources: [
      {
        url: "https://nir-zvi.co.il/marble-pricing/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://nir-zvi.co.il/marble-for-kitchen/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Third-generation family firm (page says over 50 years) importing, fabricating and installing natural stone and surfaces; factory phone 08-9222639. Publishes indicative per-running-metre prices (see stones.sources.md)."
  },
  {
    id: "segev-carmel-stone",
    name: "Segev Carmel Stone",
    nameHe: "שיש שגב כרמל",
    kind: "fabricator",
    offers: ["quartz", "porcelain", "sintered", "marble", "travertine"],
    services: ["showroom", "outdoor-kitchens", "design-projects"],
    city: "Bnei Brak",
    cityHe: "בני ברק",
    region: "Center",
    lat: 32.08,
    lon: 34.83,
    coordsNote: "town-centre",
    address: "Showrooms: Lehi 21 Bnei Brak; HaAvoda 36 Ashdod; Arik Design, David Sahorov 3 Rishon LeZion",
    addressHe: "אולמות תצוגה: לח\"י 21 בני ברק; העבודה 36 אשדוד; אריק דייזיין, דוד סחרוב 3 ראשון לציון",
    phone: "*8489",
    website: "https://www.segevltd.co.il/",
    sources: [
      {
        url: "https://www.segevltd.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://www.segevltd.co.il/shop/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Catalogue brands on its shop page: Dekton, Caesar Stone, Atlas Plan, Sapienstone, Silestone, Infinity, Sensa. No slab models or prices readable on the pages fetched. No northern showroom listed."
  },
  {
    id: "daniel-marble-haifa",
    name: "Daniel Marble",
    nameHe: "שיש דניאל - שיש למטבחים בע\"מ",
    kind: "fabricator",
    offers: ["porcelain", "quartz", "sintered", "marble", "granite", "quartzite", "onyx", "travertine"],
    services: ["showroom", "measure", "fabricate", "install", "countertop-replacement", "sinks", "wall-cladding"],
    city: "Haifa",
    cityHe: "חיפה",
    region: "Haifa & North Coast",
    lat: 32.8,
    lon: 35.0,
    coordsNote: "town-centre",
    address: "7 HaAmalim St., Haifa",
    addressHe: "העמלים 7, חיפה",
    phone: "04-6881812",
    website: "https://dmarble.co.il/",
    sources: [
      {
        url: "https://dmarble.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://dmarble.co.il/%D7%93%D7%92%D7%9E%D7%99-%D7%A9%D7%99%D7%A9/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://dmarble.co.il/%d7%a9%d7%90%d7%9c%d7%95%d7%aa-%d7%95%d7%aa%d7%a9%d7%95%d7%91%d7%95%d7%aa/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Single showroom, laser measuring, own CNC factory, authorised Dekton fabricator. Catalogue of 1,027 models from 18 brands (Infinity, Caesarstone, Ascale, Primo Top, Sensa, Caesar Porcelain, Laminam, Dekton, DK Stone, ABK Stone, Atlas Plan, Eliahu Hasson Natural, Terra, Level, Novo Corso, Silestone, Florim, Florente). Page \"marble for kitchens in the north\" says it serves the north. Hours Sun-Thu 09:00-17:00, Fri 09:00-13:00. Prices only at the showroom.",
    servesNorth: true
  },
  {
    id: "jan-marble-netivot",
    name: "Jan Marble",
    nameHe: "שיש ג'אן",
    kind: "fabricator",
    offers: ["porcelain", "sintered", "quartz", "natural-stone"],
    services: ["showroom", "measure", "fabricate", "install", "delivery"],
    city: "Netivot",
    cityHe: "נתיבות",
    region: "South",
    lat: 31.42,
    lon: 34.59,
    coordsNote: "town-centre",
    address: "10 HaHarash St., Netivot",
    addressHe: "החרש 10, נתיבות",
    phone: "08-6631914",
    website: "https://jan-marble.co.il/",
    sources: [
      {
        url: "https://jan-marble.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://jan-marble.co.il/product-category/%D7%9B%D7%9C-%D7%93%D7%92%D7%9E%D7%99-%D7%94%D7%A9%D7%99%D7%A9/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://jan-marble.co.il/product-category/%D7%A9%D7%99%D7%A9-%D7%93%D7%A7%D7%98%D7%95%D7%9F/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Direct-import porcelain/Dekton/quartz house; says it serves all of Israel. Publishes promotional running-metre prices (24-hour lineup) incl. VAT, measuring, delivery and installation. Google rating shown as 5.0 without a review count (not recorded). WhatsApp 050-3000243."
  },
  {
    id: "agam-marble-rishon",
    name: "Agam Marble",
    nameHe: "שיש אגם",
    kind: "fabricator",
    offers: ["quartz", "porcelain", "sintered", "marble", "granite", "quartzite"],
    services: ["showroom", "measure", "fabricate", "install"],
    city: "Rishon LeZion",
    cityHe: "ראשון לציון",
    region: "Center",
    lat: 31.97,
    lon: 34.79,
    coordsNote: "town-centre",
    address: "43 Etzel St., Rishon LeZion",
    addressHe: "אצל 43, ראשון לציון",
    phone: "050-999-36-77",
    website: "https://a-marble.co.il/",
    sources: [
      {
        url: "https://a-marble.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://a-marble.co.il/%D7%A9%D7%99%D7%A9-%D7%9C%D7%9E%D7%98%D7%91%D7%97-%D7%91%D7%9E%D7%A8%D7%9B%D7%96/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Says it serves Hadera to Gedera, with CNC cutting and on-site measuring. No prices published. Second phone 053-534-9641."
  },
  {
    id: "ravinsky-marble",
    name: "Ravinsky Marble",
    nameHe: "שיש רבינסקי בע\"מ",
    kind: "importer",
    offers: ["quartz", "porcelain", "marble", "granite", "travertine", "glass"],
    services: ["showroom", "measure", "fabricate", "install", "countertop-replacement"],
    city: "Petah Tikva",
    cityHe: "פתח תקווה",
    region: "Center",
    lat: 32.08,
    lon: 34.89,
    coordsNote: "town-centre",
    address: "Showrooms: Ravinsky 1, Petah Tikva; Kislev 9, Kiryat Gat",
    addressHe: "רבניצקי 1, פתח תקווה; כסלו 9, קרית גת",
    phone: "073-7814103",
    website: "https://www.ravinsky.co.il/",
    sources: [
      {
        url: "https://www.ravinsky.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Operating since 1986; exclusive Israeli representative of Stone Italiana; own plant. Head office 03-9349394. Google rating on its own page: 4.1 from 67 reviews.",
    rating: {
      value: 4.1,
      count: 67,
      source: "Google rating as shown on ravinsky.co.il",
      readAt: "2026-11-14"
    }
  },
  {
    id: "opal-stone-holon",
    name: "Opal Stone",
    nameHe: "שיש אופל סטון",
    kind: "stone-yard",
    offers: ["quartz", "porcelain", "marble", "natural-stone", "sintered"],
    services: ["showroom", "measure", "fabricate", "install", "delivery"],
    city: "Holon",
    cityHe: "חולון",
    region: "Center",
    lat: 32.02,
    lon: 34.77,
    coordsNote: "town-centre",
    address: "19 HaMelacha St., Holon industrial zone",
    addressHe: "המלאכה 19, אזור תעשייה חולון",
    phone: "055-4543969",
    website: "https://opalstone.co.il/",
    sources: [
      {
        url: "https://opalstone.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Showroom with over 600 full-size slabs; brands named on its page: Nuovo Corso, Laminam, Infinity, Dekton, Caesarstone, Florim, Eskala. WhatsApp 054-7257455. Price list is linked but not read."
  },
  {
    id: "dan-marble-petah-tikva",
    name: "Dan Marble",
    nameHe: "שיש דן",
    kind: "importer",
    offers: ["porcelain", "marble", "granite", "quartz", "onyx"],
    services: ["showroom", "slab-yard", "custom-fabrication"],
    city: "Petah Tikva",
    cityHe: "פתח תקווה",
    region: "Center",
    lat: 32.08,
    lon: 34.89,
    coordsNote: "town-centre",
    address: "3 Inbar St., Segula industrial zone, Petah Tikva; Jerusalem branch at Moshav Ora (by appointment)",
    addressHe: "ענבר 3, אזור תעשייה סגולה, פתח תקווה; סניף ירושלים במושב אורה (בתיאום)",
    phone: "077-8038979",
    website: "https://www.dan-marble.co.il/",
    sources: [
      {
        url: "https://www.dan-marble.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Official exclusive importer of AtlasPlan porcelain slabs (per its home page). A search-result summary says measuring and installation are done by a fabricator of the customer's choice - not confirmed on the page read."
  },
  {
    id: "fervital-granite",
    name: "Fervital",
    nameHe: "פרביטל גרניט בע\"מ",
    kind: "importer",
    offers: ["marble", "granite", "porcelain", "quartz", "onyx", "sintered"],
    services: ["showroom", "design", "fabricate", "install"],
    city: "Herzliya",
    cityHe: "הרצליה",
    region: "Center",
    lat: 32.16,
    lon: 34.84,
    coordsNote: "town-centre",
    address: "Showrooms: 14 Mishkit St., Herzliya Pituach; Emek Hefer industrial zone (factory and showroom); Bnei Brak Design Center, floor G",
    addressHe: "משקית 14, הרצליה פיתוח; אזור תעשייה עמק חפר (מפעל ותצוגה); דיזיין סנטר בני ברק, קומה ג'",
    phone: "*5299",
    website: "https://www.fervital1.co.il/",
    sources: [
      {
        url: "https://www.fervital1.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Exclusive Israeli representative of Antolini (since 2011) and inalco (since 2017); says about 200 slab types in stock."
  },
  {
    id: "polostone-zippori",
    name: "PoloStone",
    nameHe: "פולוסטון",
    kind: "brand",
    offers: ["porcelain"],
    services: ["manufacturer", "warranty"],
    city: "Zippori Industrial Zone",
    cityHe: "אזור תעשייה ציפורית",
    region: "Lower Galilee",
    lat: 32.76,
    lon: 35.28,
    coordsNote: "town-centre",
    address: "HaMaof St., Zippori industrial zone (logistics centre; no showroom address on the page)",
    addressHe: "רחוב המעוף, אזור תעשייה ציפורית",
    phone: "072-395-3021",
    website: "https://polostone.co.il/",
    sources: [
      {
        url: "https://polostone.co.il/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      },
      {
        url: "https://polostone.co.il/product-category/slab/",
        kind: "own-site",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: true,
    listingOnly: false,
    notes: "Describes itself as a manufacturer (not a distributor) of architectural porcelain slabs, 1600x3200 / 1620x3240 mm, lifetime warranty on the surface. Slab category shows 54 models."
  },
  {
    id: "asadi-marble-majd-al-krum",
    name: "Shesh Asadi",
    nameHe: "שיש אסאדי",
    kind: "fabricator",
    offers: ["natural-stone", "quartz", "granite", "caesarstone"],
    services: ["showroom", "fabricate"],
    city: "Majd al-Krum",
    cityHe: "מג'ד אל-כרום",
    region: "Western Galilee",
    lat: 32.92,
    lon: 35.25,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "072-3213471 (virtual forwarding number per the directory)",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/80034787/48670/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory text: makes and processes natural stone, quartz, granite and Caesar stone for kitchens, bathrooms, countertops, stairs; \"official importer of Italian granite and marble and official Caesar stone agent\"; service areas Kiryat Ata, Shefa-Amr, Nazareth, Tiberias, Karmiel. Second number 050-7328710 appears only in the share text.",
    rating: {
      value: 4.7,
      count: 3,
      source: "d.co.il directory listing",
      readAt: "2026-11-14"
    }
  },
  {
    id: "asadi-marble-safed",
    name: "Shesh Asadi - Safed listing",
    nameHe: "שיש אסאדי (צפת)",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Safed",
    cityHe: "צפת",
    region: "Upper Galilee",
    lat: 32.96,
    lon: 35.5,
    coordsNote: "town-centre",
    address: "HaChalutz St., Safed",
    addressHe: "החלוץ, צפת",
    phone: "04-8286813",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Separate directory listing under the same business name; no description. Not verified to be the same business as the Majd al-Krum listing."
  },
  {
    id: "marble-center-check-post-haifa",
    name: "Marble Center Check Post Ltd.",
    nameHe: "שיש סנטר צ'ק פוסט בע\"מ",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Haifa",
    cityHe: "חיפה",
    region: "Haifa & North Coast",
    lat: 32.79,
    lon: 34.99,
    coordsNote: "town-centre",
    address: "12 Marconi St., Haifa",
    addressHe: "מרקוני 12, חיפה",
    phone: "072-3216358",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e2-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing without a description.",
    rating: {
      value: 4.8,
      count: 33,
      source: "d.co.il directory listing",
      readAt: "2026-11-14"
    }
  },
  {
    id: "a-aviv-marble-kiryat-bialik",
    name: "Shesh A. Aviv Ltd.",
    nameHe: "שיש א.אביב בע\"מ",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Kiryat Bialik",
    cityHe: "קרית ביאליק",
    region: "Haifa & North Coast",
    lat: 32.83,
    lon: 35.09,
    coordsNote: "town-centre",
    address: "9 Baalei Melakha St., Kiryat Bialik",
    addressHe: "בעלי מלאכה 9, קרית ביאליק",
    phone: "072-3263005",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e2-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing without a description.",
    rating: {
      value: 4.7,
      count: 31,
      source: "d.co.il directory listing",
      readAt: "2026-11-14"
    }
  },
  {
    id: "mohammad-marble-karmiel",
    name: "Mohammad Marble Works",
    nameHe: "מוחמד עבודות שיש",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Karmiel",
    cityHe: "כרמיאל",
    region: "Western Galilee",
    lat: 32.92,
    lon: 35.3,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "054-7355963",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e2-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "shesh-shesh-mitbachim-karmiel",
    name: "Shesh Shesh Mitbachim",
    nameHe: "שיש שיש מטבחים",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Karmiel",
    cityHe: "כרמיאל",
    region: "Western Galilee",
    lat: 32.92,
    lon: 35.3,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "052-5598999",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e2-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "omanut-baeven-kiryat-ata",
    name: "Omanut baEven",
    nameHe: "אומנות באבן",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Kiryat Ata",
    cityHe: "קרית אתא",
    region: "Haifa & North Coast",
    lat: 32.81,
    lon: 35.11,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "050-5805049",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e2-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "winkler-shalmon-kiryat-ata",
    name: "A. Winkler - Shalmon Ltd.",
    nameHe: "\"א. וינקלר\" - שלמון בע\"מ",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Kiryat Ata",
    cityHe: "קרית אתא",
    region: "Haifa & North Coast",
    lat: 32.81,
    lon: 35.11,
    coordsNote: "town-centre",
    address: "5 HaDeshanim St., Kiryat Ata",
    addressHe: "הדשנים 5, קרית אתא",
    phone: "04-8721702",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e2-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing in the marble category; no further details."
  },
  {
    id: "uthman-marble-tamra",
    name: "Shesh Uthman Ahmad Khalil",
    nameHe: "שיש עותמאן אחמד חליל",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Tamra",
    cityHe: "טמרה",
    region: "Western Galilee",
    lat: 32.85,
    lon: 35.2,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "04-9942629",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e2-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "abu-fauzi-marble-tamra",
    name: "Shesh Tamra Abu Fauzi",
    nameHe: "שיש טמרה אבו פוזי",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Tamra",
    cityHe: "טמרה",
    region: "Western Galilee",
    lat: 32.85,
    lon: 35.2,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "04-9946182",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e2-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "shesh-shmona-kiryat-shmona",
    name: "Shesh Shmona Ltd.",
    nameHe: "שיש שמונה בע\"מ",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Kiryat Shmona",
    cityHe: "קרית שמונה",
    region: "Upper Galilee",
    lat: 33.21,
    lon: 35.57,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "072-3255627",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "yehuda-marble-kiryat-shmona",
    name: "Shesh Yehuda",
    nameHe: "שיש יהודה",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Kiryat Shmona",
    cityHe: "קרית שמונה",
    region: "Upper Galilee",
    lat: 33.21,
    lon: 35.57,
    coordsNote: "town-centre",
    address: "Southern industrial zone, Kiryat Shmona",
    addressHe: "אזור תעשייה דרומי, קרית שמונה",
    phone: "072-3253205",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "hamumchim-marble-hazor",
    name: "Shesh HaMumchim Ltd.",
    nameHe: "שיש המומחים בע\"מ",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Hazor HaGlilit",
    cityHe: "חצור הגלילית",
    region: "Upper Galilee",
    lat: 32.98,
    lon: 35.54,
    coordsNote: "town-centre",
    address: "58 HaMasger St., Hazor HaGlilit",
    addressHe: "המסגר 58, חצור הגלילית",
    phone: "072-3203074",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing without a description.",
    rating: {
      value: 4.1,
      count: 17,
      source: "d.co.il directory listing",
      readAt: "2026-11-14"
    }
  },
  {
    id: "trabia-marble-hazor",
    name: "Shesh Trabia Ltd.",
    nameHe: "שיש טרביה בע\"מ",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Hazor HaGlilit",
    cityHe: "חצור הגלילית",
    region: "Upper Galilee",
    lat: 32.98,
    lon: 35.54,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "04-6936980",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "asaad-marble-beit-shean",
    name: "Shesh 2000 Asaad & Sons",
    nameHe: "שיש 2000 אסעד ובניו",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Beit She'an",
    cityHe: "בית שאן",
    region: "Jordan Valley",
    lat: 32.5,
    lon: 35.5,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "055-6667135",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Only business found in the Beit She'an / Jordan Valley area; directory listing, no further details. Contact by phone.",
    servesNorth: true
  },
  {
    id: "salem-marble-nazareth",
    name: "Shesh Salem",
    nameHe: "שיש סאלם",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Nazareth",
    cityHe: "נצרת",
    region: "Lower Galilee",
    lat: 32.7,
    lon: 35.3,
    coordsNote: "town-centre",
    address: "20 Street 5011, Nazareth",
    addressHe: "רח' 5011 20, נצרת",
    phone: "050-3694556",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "al-alaa-marble-nazareth",
    name: "Shesh Al-Alaa",
    nameHe: "שיש אלעלאא",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Nazareth (Khalat a-Dayr)",
    cityHe: "נצרת (ח'אלת א דיר)",
    region: "Lower Galilee",
    lat: 32.7,
    lon: 35.3,
    coordsNote: "town-centre",
    address: "Khalat a-Dayr, Nazareth",
    addressHe: "ח'אלת א דיר, נצרת",
    phone: "04-6020063",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p40-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "yafia-marble-trade",
    name: "S.A. Shesh Sahar Klali",
    nameHe: "ש.ע. שיש סחר כללי",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Yafia",
    cityHe: "יפיע",
    region: "Lower Galilee",
    lat: 32.69,
    lon: 35.33,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "04-6011232",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p0-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "dabbah-stone-deir-al-asad",
    name: "Even veShesh Dabbah",
    nameHe: "אבן ושיש דבאח",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Deir al-Asad",
    cityHe: "דיר אל-אסד",
    region: "Western Galilee",
    lat: 32.94,
    lon: 35.27,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "054-6522446",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p40-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  },
  {
    id: "shesh-hatzafon-kfar-manda",
    name: "Shesh HaTzafon",
    nameHe: "שיש הצפון",
    kind: "fabricator",
    offers: [],
    services: [],
    city: "Kafr Manda",
    cityHe: "כפר מנדא",
    region: "Lower Galilee",
    lat: 32.82,
    lon: 35.26,
    coordsNote: "town-centre",
    address: null,
    addressHe: null,
    phone: "052-8655795",
    website: null,
    sources: [
      {
        url: "https://www.d.co.il/h-c48670-e10-p40-l0/",
        kind: "directory",
        checkedAt: "2026-11-14"
      }
    ],
    ownSite: false,
    listingOnly: true,
    notes: "Directory listing only; no further details."
  }
];
export default STONE_SUPPLIERS;
