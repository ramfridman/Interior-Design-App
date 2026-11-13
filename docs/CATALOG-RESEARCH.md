# Catalogue research guide (market-research team)

You build one data file of **real products sold in Israel today**, each with its real current price (₪), real
dimensions and the real product-page URL. The home-owner will click these links to buy — accuracy is everything.

Read first: `docs/CONTRACT.md` § 6 (schema + hard rules), `src/models/types.js` (closed list of model `type`s
with their `params`, and the `CATEGORIES` tree), `src/catalog/index.js` (`validateProduct`).

You own exactly two files: `src/catalog/data/<your-file>.js` (`export default [ … ]`) and
`src/catalog/data/<your-file>.sources.md`. Touch nothing else. No git commands.

## Hard rules
1. **Never invent or guess** a product, price, dimension or URL. Name, price and URL must be read from a page or API
   response you fetched in this task; dimensions from the same page or the manufacturer's official spec.
   Cannot verify a field → drop the product. A smaller, fully real catalogue beats a bigger, partly invented one.
2. URL = the direct https product page a shopper buys from. No search-result, comparison-site (Zap) or redirect links.
3. Price = what the shopper pays now, incl. VAT, in ILS (on sale → that price, plus tag `on-sale`). `priceDate: '2026-11'`.
4. Spread over **at least 5–6 Israeli retailers** and budget / mid / premium tiers; real variety of sizes, shapes,
   colours and styles. Do not let one store exceed ~40 % of your file.
5. `type` must be one of `MODEL_TYPES`; `params` only from that type's vocabulary plus the common ones
   (`color`, `color2`, `color3` as hex estimated from the product photo; `material`, `material2`, `style`).
6. ids: kebab-case, unique, prefixed by the retailer slug (e.g. `ikea-…`, `ace-…`).

## How to research (network goes through a proxy; all of these work here)
* `WebSearch` / `WebFetch` (load via ToolSearch `select:WebSearch,WebFetch`) — Hebrew queries work best.
* `curl -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" <url>`
* JavaScript-rendered shops: preinstalled Playwright (`require('playwright')`, `chromium.launch()`; it honours the
  proxy) — read the rendered DOM or `script[type="application/ld+json"]` (name, price, sku).
* Shop platforms often expose JSON: Shopify `/products/<handle>.js`, `/collections/<c>/products.json?limit=250`;
  WooCommerce `/wp-json/wc/store/products?per_page=100`; IKEA product pages embed price + measurements.
* **Work in bulk with scripts**, not page-by-page by hand: write a small Node/Python script that fetches a listing
  or JSON feed, extracts name / price / url / dimensions, and saves compact JSON to your own scratch folder
  `<scratchpad>/<your-file>/` (scratchpad = `/tmp/claude-0/-home-user-Interior-Design-App/92a78ed2-1f75-5293-a8bd-74074184bc03/scratchpad`).
  Only print short summaries to your console — never dump raw HTML into your context.
* Be polite: sequential requests, ~0.5–1 s apart, cache what you fetch. If a site blocks you (403 / captcha), move on
  to another retailer — never bypass protections.
* A previous, interrupted run left some raw material in the scratchpad root that you MAY mine (treat as untrusted
  hints and re-verify price + URL for anything you use): `ikea_data.json`, `ikea_all.txt`, `ikea/`, `ace_list.json`,
  `ace_list.txt`, `cache/` (raw HTML), `evidence/`, `kb/`, `outdoor/`, `garden/`.

## Finish
1. Validate: `node -e "import('./src/catalog/index.js').then(async c=>{const p=await c.loadCatalog();console.log(p.length)})"`
   prints warnings for rejected products — fix them; ids unique across the whole catalogue.
2. Re-fetch a random sample of 12 of your product URLs: each must return HTTP 200 and still show the recorded price.
3. `<your-file>.sources.md`: retailers used, how price / dimensions were read per retailer, date, what was dropped and
   why, caveats (e.g. price varies by fabric).
4. Final report (concise): product count per sub-category and per retailer, price range, sample re-verification
   result, retailers that blocked access.

## Gap-fill pass, 13 Nov 2026
Added 28 real products (catalogue 850 -> 878; no validation warnings, no duplicate ids). Details and URLs in `src/catalog/data/lighting-decor.sources.md` and `garden-landscape.sources.md`.

| Gap | Added | File |
|---|---|---|
| Long linear pendants | 8 (IKEA 3, LED Market 5) | lighting-decor.js |
| Fountains / water features | 7 (Aquarium King 6, Tropical Fish 1) | garden-landscape.js |
| Bird baths | 0 | - |
| WPC decking | 0 | - |
| Paving / stepping stones | 2 (Bialik Nurseries, natural stone; no concrete pavers found) | garden-landscape.js |
| Date and specimen palms | 1 (Phoenix roebelenii, published height 3 m) | garden-landscape.js |
| Heat-pump water heaters | 0 | - |
| Clothes racks / wall rack | 6 (IKEA 2, ACE 3, Home Center 1) | garden-landscape.js |
| Composters | 4 (Composter.co.il 2, gardensheds.co.il 2) | garden-landscape.js |

Could not be found with all required data: bird baths with price and size from an Israeli shop; WPC decking with a stated price unit and thickness (Carmel Floor UH100R lists no unit); concrete pavers sold online; large date palms with published trunk height and spread; heat-pump boilers with published dimensions (Mashav lists prices only, and the two Mashav sites disagree); rotary clotheslines with a height (Leifheit via Home Center external seller). Composters have no own subcategory, so they use `outdoor-storage` / `bins`.
