# Public hosting plan — E7 House Designer

Status: **plan only, nothing here has been done yet.** Written 13 Nov 2026.

## Owner's decisions (13 Nov 2026)

| Question | Decision |
| --- | --- |
| Who can open it | **Only invited people** |
| Site shows the floor plan, lot number, "Kibbutz Afikim", parking | **Acceptable** |
| Address | **Free host subdomain** (no custom domain) |
| Search engines | **Keep it out for now** (`robots.txt` + `noindex`) |

**Chosen route: Cloudflare Pages + Cloudflare Access** (section 5, steps 0, 1, 2B, 3–6). Vercel is not used: its free plan does not offer invite-only access for the production site.

Needed from the owner on the day:
1. A free Cloudflare account (sign-up with an email address; no payment card is required for Pages or for Access on the free plan as far as I know — confirm at sign-up).
2. Authorising Cloudflare's GitHub app for the `interior-design-app` repo (done by the owner in the browser).
3. The list of email addresses to invite. Each invited person signs in with a one-time code sent to that address.

## 1. Where the app runs today

| Copy | Where | Who can open it |
| --- | --- | --- |
| Claude artifact | `https://claude.ai/artifact/8ZvK3RLvmdmFnunBS8Mi1R` | Only you, until you share it from the page's Share menu |
| Source | GitHub repo `ramfridman/interior-design-app`, branch `ccr-70c095fe-io3e41` | Whoever has access to the repo |

The app itself is **plain static files**: `index.html`, `src/`, `vendor/`. There is no server, no database, no build step and no dependency on Claude. The artifact is just one packaged copy of those files. Any static web host can serve it, and it will behave the same, with two differences that are improvements:

* In the artifact, file downloads and printing go through the host's sandbox (a confirmation dialog, or a copy-to-clipboard fallback). On a normal host, "Save design", "Export PNG", "Export CSV" and "Print" work natively.
* Mouse capture for the walk-through works without the sandbox restrictions.

## 2. What "other users" get

Each visitor's design is stored **in their own browser** (localStorage). So:

* Everyone who opens the URL starts from the architect's layout of house 98 and works on their own private copy.
* Nothing one person does is visible to another. To pass a design along, use Save design (a `.json` file) and Open design.
* Clearing browser data or switching device loses the design unless it was saved to a file.

If you later want people to see *your* design at a link, or to work on one design together, that is a separate feature (section 8).

## 3. Decisions to make first

1. **Who should be able to open it?**
   * *Anyone with the link* — simplest; the URL is unguessable-ish but not secret.
   * *Only people you invite* — needs an access layer (section 5, option B).
2. **Is it acceptable that the site shows your house?** The app contains the full floor plan, the lot number, "Kibbutz Afikim", room sizes and the parking layout. It does not contain your family name or the architect's contact details; those are only in the two PDFs under `docs/reference/`, which must **not** be deployed.
3. **Address:** a free host subdomain (`something.pages.dev`, `something.vercel.app`) or your own domain (about ₪40–60 a year for a `.com`; optional).
4. **Search engines:** keep it out of Google (recommended for a private house) or allow indexing.

## 4. Host options (all have a free tier for a site this size)

The site is about 3 MB and fully static, so every option below handles it comfortably. Free-tier limits and what is paid change over time; **re-check the pricing page on the day**.

| Host | Deploys from a private repo for free | Free access restriction | Notes |
| --- | --- | --- | --- |
| **Cloudflare Pages** | Yes | Yes — Cloudflare Access, free for a small team (email one-time code) | No bandwidth cap on static assets as far as I know. Best fit if you want invite-only. |
| **Vercel** | Yes | Limited on the free plan (protection mainly for preview links) | A Vercel connector is already attached to this Claude session, so I can create the project and deploy for you. Free plan is for personal, non-commercial use. |
| **Netlify** | Yes | Password protection is a paid feature | Comparable to Vercel; no advantage here. |
| **GitHub Pages** | Only if the repo is public (private-repo Pages needs a paid GitHub plan) | No | Making the repo public would also expose the PDFs in `docs/reference/` and the full history. Not recommended unless the site is published from a separate, clean repo. |

**Recommendation**

* Link-only access is fine → **Vercel**, because I can do the whole setup from here in a few minutes.
* Invite-only access → **Cloudflare Pages + Cloudflare Access**.

A simpler stop-gap that needs no hosting at all: use the artifact's own Share menu on claude.ai. Whether outside viewers get every feature there (for example file downloads) depends on their Claude access, so treat it as a quick preview link, not the long-term home.

## 5. Implementation steps

### Step 0 — Finish and merge (prerequisite)
* Complete the features in progress (structure editing, sun controls, catalogue gaps, UX review).
* Open a pull request from `ccr-70c095fe-io3e41` into the default branch and merge it, so the host deploys from a stable branch.

### Step 1 — Add a site build script
`dev/build-site.mjs` (sibling of the existing `dev/build-artifact.mjs`) that writes a clean `dist/site/` containing only what the browser needs:

* Include: `index.html`, `src/**/*.js`, `src/styles/**`, `vendor/three/` (only the files actually imported), `vendor/fonts/`.
* Exclude: `docs/` (especially `docs/reference/*.pdf`), `dev/`, `tests/`, `*.sources.md`, `dist/`, repo metadata.
* Do **not** set `window.APP_ENV.sandboxed` (that flag is only for the artifact), so native download and print are used.
* Add `robots.txt` with `Disallow: /` and `<meta name="robots" content="noindex">` if you chose to stay out of search engines.
* Add a small "prices checked November 2026" note in the catalogue footer (prices are a snapshot).
* Optional: fingerprint file names or set cache headers so updates reach visitors immediately (see step 4).

### Step 2A — Deploy on Vercel (link-only access)
1. Create a Vercel project linked to the GitHub repo (or deploy `dist/site/` directly without Git integration).
2. Settings: framework "Other", build command `node dev/build-site.mjs`, output directory `dist/site`.
3. Production branch = the default branch. Every push redeploys automatically.
4. Result: `https://<project>.vercel.app`. Optionally attach a custom domain.

### Step 2B — Deploy on Cloudflare Pages (invite-only access)
1. Create a Cloudflare account, then Pages → connect the GitHub repo.
2. Build command `node dev/build-site.mjs`, output directory `dist/site`.
3. Zero Trust → Access → add an application for the site's hostname with a policy "emails in this list"; visitors sign in with a one-time code sent to their email.
4. Result: `https://<project>.pages.dev`, reachable only by the people on the list.

### Step 3 — Security headers
Add the host's headers file (`vercel.json` or `_headers`) with:

* `Content-Security-Policy`: `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'` (adjust after testing; the app loads nothing from other origins at runtime).
* `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
* Retailer links already open with `rel="noopener noreferrer"`.

### Step 4 — Caching
* `index.html`: `Cache-Control: no-cache` so visitors always get the current entry page.
* `vendor/**`: long cache (`max-age=31536000, immutable`).
* `src/**`: short cache (for example 5 minutes) unless file names are fingerprinted.

### Step 5 — Verify the live site
* Run the existing smoke test against the deployed URL (boot, 2D, 3D, walk, split, place / rotate / undo).
* Manually on a real computer and a phone: walk-through with mouse capture, Save / Open design, PNG and CSV export, print, light and dark theme.
* Check 3D frame rate on a real graphics card (so far it has only been measured on a software renderer).
* Open ten random product links and confirm they land on the right retailer page.

### Step 6 — Hand-over
* Put the URL and the "how to update" note in the repo README.
* Decide who gets the link, or add their emails to the access list.

## 6. Things to settle before going public

* **Product data.** Names, prices and links were read from retailer pages in November 2026 and will drift. Show the date, and plan a refresh (section 7). Retailer and brand names are used only to identify products; no retailer images are used (thumbnails are rendered from the app's own 3D models).
* **Regulations panel.** It already carries a disclaimer that it is a design aid, not a permit review. Keep that visible on the public site.
* **Licences.** Three.js (MIT) and the two fonts (OFL) are redistributable; their licence files are in `vendor/`.
* **Your privacy.** Re-read section 3, point 2. If the site is public, anyone with the link can see the layout of your home.

## 7. Keeping it current

* **Updates:** push to the default branch → the host rebuilds and redeploys in about a minute.
* **Prices:** the research scripts that collected the catalogue are not in the repo. If periodic refresh matters, add a small script per retailer (IKEA, ACE, Home Center and the Shopify / WooCommerce shops are scriptable) that re-reads price and availability for every catalogue URL and reports changes; run it monthly.
* **Cost:** ₪0 on the free tiers at this size; a custom domain is the only optional cost.

## 8. Possible later additions (not part of this plan)

* **Share a design by link** — store a design on a small free backend (for example a Cloudflare Worker with KV, or Vercel Blob) and open it with `?design=<id>`.
* **Accounts and cloud save** so a design follows the person across devices.
* **Installable / offline app** (PWA manifest + service worker).
* **Other houses** — the engine reads one plan file; supporting several plans or an import flow would turn it into a general tool.
