# Hosting plan — E7 House Designer on the web, invite-only, with shared projects

Status (14 Nov 2026): **everything is built and tested on this computer; nothing is deployed.** The app, a small backend
(a Cloudflare Worker with Durable Objects, in `server/`) and the sharing features (Share, History, people in the top bar)
run together under Cloudflare's own local runtime (`wrangler dev`) and pass the tests. What is left needs **your**
Cloudflare account and takes about 30 minutes of clicking, following section 4 below. Steps that I could not try because
they need your account are listed in section 9.

Note (14 Nov 2026): the repository now has a `main` branch (created at the version 23 commit). Use `main` as the production branch when connecting the repository to Cloudflare, and make it the default branch in GitHub → Settings → Branches.

## Owner's decisions (13 Nov 2026)

| Question | Decision |
| --- | --- |
| Who can open it | **Only invited people** |
| Site shows the floor plan, lot number, "Kibbutz Afikim", parking | **Acceptable** |
| Address | **Free host subdomain** (no custom domain) |
| Search engines | **Keep it out for now** (`robots.txt` + `noindex`) |

**Chosen route: one Cloudflare Worker (the site + the backend) behind Cloudflare Access, on the free plan.** The address
will be `https://e7-house-designer.<your-account-name>.workers.dev`. (The earlier plan used Cloudflare Pages for a static
site; saved projects shared by several people need a backend, and a Worker serves both from one place.)

## 1. What people get

* **Projects on this device** work as before: stored in the browser, private to that person.
* **Online projects**: the project menu → **Share…** → **Put online**. The project is then saved on the server, and the
  owner adds people by email as **can edit** or **can view**. Everyone in the project sees the others' changes within a
  fraction of a second, their pointers and selections, and who is in the project (avatars in the top bar; on a phone, a
  small number). Viewers see a "View only" banner and the editing tools are greyed out.
* **History…** in the project menu: restore points are saved automatically (after a quiet spell and every 200 changes; the
  last 20 kept) and by hand ("Save a version now"). **Restore** changes the project for everyone; the state just before is
  saved first as "Before restoring …", so a restore can be undone by restoring that point.
* **Copy link** in the Share dialog gives an address that opens the project directly (`…/?online=<id>`).
* **Keep a copy on this device** (Share dialog, or project menu → Duplicate on this device) makes a private copy.

Two gates protect a project: **Cloudflare Access** decides who can open the site at all (the invite list, section 5), and
the **Share dialog** decides who can open each project. A person needs both.

## 2. What it costs

**Nothing**, on Cloudflare's free plans, at this size. No payment card should be needed for Workers Free; Cloudflare asks
for one when you turn on Zero Trust (Access) on some accounts even for the free plan — if it does, the free plan still costs
₪0 (confirm on the day; I could not see the sign-up form).

Free-plan limits in plain words (checked 14 Nov 2026, links in `server/README.md`):

* **100,000 requests a day** to the backend. Loading the app's files does not count (static files are free and
  unlimited). Opening a project, saving a change and each second of live dragging count a little (live messages are billed
  20 for the price of 1). Two people designing all evening use a few thousand.
* **100,000 saved changes ("rows written") a day** and **5 GB** of saved projects in all. A change writes about 2–3 rows.
* **What happens if a limit is passed:** the backend refuses work until midnight UTC (02:00 / 03:00 in Israel). The site
  still opens, projects on the device still work; online projects cannot be opened or saved until the reset. Nothing is
  lost and nothing is charged — the free plan cannot run up a bill.
* **Access:** the Zero Trust free plan covers a small team (Cloudflare has long said up to 50 users; I could not confirm the
  number in the pages I read — check under Zero Trust → Settings → Account / Plan).
* **Updates:** 3,000 build minutes a month; one update takes about 1 minute.

## 3. Before you start

1. Merge the working branch into the default branch on GitHub (a pull request), so Cloudflare builds from a stable branch.
2. Have the list of email addresses you want to invite.

## 4. Step by step

### 4.1 Create the Cloudflare account
1. Go to `https://dash.cloudflare.com/sign-up`, sign up with your email and a password, confirm the email.
2. You land on the dashboard. You do not need to add a website / domain — skip anything that asks for one.

### 4.2 Create the Worker from the GitHub repository
1. Left menu: **Workers & Pages** (under "Compute") → **Create application** (the "Create" button).
2. Choose **Import a repository** / **GitHub** → **Connect GitHub** and allow Cloudflare's GitHub app to see the repository
   `interior-design-app` (you can limit it to that one repository).
3. Pick the repository, then fill in:
   * **Project / Worker name:** `e7-house-designer` — it **must** be exactly this (it is the `name` in
     `server/wrangler.jsonc`; the build fails if they differ).
   * **Production branch:** the default branch (usually `main`).
   * **Root directory (path):** `server`
   * **Build command:** `node ../dev/build-site.mjs`
   * **Deploy command:** `npx wrangler deploy` (the default)
   * Leave "Non-production branch deploy command" as it is, or turn off builds for other branches.
4. **Save and Deploy**. The first build takes a minute or two. The two storage classes the backend needs are created by
   this first deploy automatically (they are declared in `server/wrangler.jsonc`) — there is nothing to set up by hand.
5. When it says the deployment succeeded, note the address it shows: `https://e7-house-designer.<account>.workers.dev`.
   Opening it now shows the app working on its own: online sharing stays hidden until step 4.4 is done, and anyone with the
   address can still open the site — do steps 4.3–4.4 straight away.

### 4.3 Put Cloudflare Access in front of it (invite-only)
1. Left menu: **Zero Trust**. The first time, choose a **team name** (for example `e7-family`) and the **Free** plan.
2. **Sign-in method:** Zero Trust → **Integrations** (or Settings) → **Identity providers** → **Add new identity provider**
   → **One-time PIN** → Save. (Invited people then sign in by typing their email and the 6-digit code they receive.)
3. **Who is invited:** Zero Trust → **Access controls** → **Policies** → **Add a policy**: name `Invited people`, action
   **Allow**, rule **Include → Emails** → type each invited address → Save.
4. **Protect the Worker:** Workers & Pages → `e7-house-designer` → the **Access** tab (or Settings → Domains & Routes) →
   **Protect this Worker behind Access** → traffic: **all traffic** (production and previews) → select the policy
   `Invited people` → **Apply Access**.
   *If your dashboard does not show that option:* Zero Trust → Access controls → **Applications** → **Create new
   application** → **Self-hosted and private** → **Add public hostname** → subdomain `e7-house-designer`, domain
   `<account>.workers.dev` → policy `Invited people` → identity provider One-time PIN → session duration e.g. 1 week →
   **Create**.
5. Check in a private browser window: the address now asks for an email first.

### 4.4 Tell the Worker which Access application to trust
1. **Team domain:** Zero Trust → **Settings** → **Team name and domain** (or Custom pages) → copy it, e.g.
   `e7-family.cloudflareaccess.com`.
2. **AUD tag:** Zero Trust → **Access controls** → **Applications** → the application for `e7-house-designer` →
   **Edit** (or Configure) → **Additional settings** / Overview → copy **Application Audience (AUD) Tag** (a long code).
3. Workers & Pages → `e7-house-designer` → **Settings** → **Variables and Secrets** → **Add**:
   * Type **Text**, name `ACCESS_TEAM_DOMAIN`, value `https://e7-family.cloudflareaccess.com`
   * Type **Text**, name `ACCESS_AUD`, value the AUD tag
   * Type **Text**, name `PRODUCTION`, value `1`
   → **Deploy**. (These are not secrets: they only say which Access application to trust. Later updates keep them —
   the configuration has `keep_vars`.)
4. Check: open the address, sign in with the code, start designing. A **Share** button appears in the top bar. Share →
   **Put online** → the status bar shows "Live · 1 person". If no Share button appears, the variables are wrong (the
   backend answers "not configured" and the app quietly runs without sharing).

## 5. Inviting and removing people

* **Invite:** (1) add their email to the Access policy (Zero Trust → Access controls → Policies → `Invited people` → Edit
  → Include → Emails → add → Save), then (2) open the project → Share… → type their email → **Can edit** or **Can view**
  → Add → **Copy link** and send it to them. They sign in with the code that arrives by email.
* **Change what someone can do:** Share… → the selector next to their email. It takes effect at once, even while they are
  in the project.
* **Remove from one project:** Share… → the × next to their email. If they have it open, it closes on their screen.
* **Remove from the site:** delete their email from the Access policy. (Sign-ins already made last until the Access
  session expires — the session duration you chose; Zero Trust → My team → Users → the person → **Revoke** ends it at once.)
* Only the owner (the person who put the project online) can change who has access or delete the online project.

## 6. Updates

Push (or merge) to the production branch on GitHub. Cloudflare builds and deploys by itself in about a minute
(Workers & Pages → `e7-house-designer` → Deployments shows each one). People with the app open get the new version when
they reload; if the collaboration protocol changed, the app asks them to reload.

## 7. Exporting and deleting

* **Export one project:** open it → project menu → **Export project file** (a `.json` file with the plan, furniture,
  finishes, carpentry and the sketch). Re-import with **Import project file…**. Restore points are not in the file.
* **A copy in the browser:** Share… → **Keep a copy on this device**.
* **Export everything:** there is no single "export all" button; export each online project from its project menu.
* **Delete an online project:** open it as its owner → project menu → **Delete online project…** → confirm. It is
  removed from the server for everyone, with its history.
* **Delete the whole site and data:** Workers & Pages → `e7-house-designer` → Settings → **Delete**; also delete the Access
  application. (Whether deleting the Worker also erases its stored projects at once, I could not confirm — delete the
  online projects first if that matters.)

## 8. Security and privacy (already in place)

* Only people who pass Cloudflare Access reach the site; the backend additionally checks Access's signed token on every
  request (signature, audience, expiry) and takes the email from it — nothing a browser can fake.
* Each project's roles are checked on the server for every request and every live connection; viewers cannot change
  anything. Connections from other websites are refused.
* `robots.txt`, a `noindex` tag and an `X-Robots-Tag` header keep search engines out; a Content-Security-Policy allows only
  the site itself (and its own live connection). `docs/` (with the architect's PDFs), `dev/` and `tests/` are not published.
* No secrets are stored in the repository.

## 9. What I could not test (needs your account)

* Signing up, Zero Trust plan selection and whether a payment card is asked for.
* Workers Builds from GitHub: the exact menu wording, the root directory `server` + build command
  `node ../dev/build-site.mjs`, and the first deploy creating the Durable Objects. (The configuration itself was checked
  with `wrangler deploy --dry-run`, and everything ran under `wrangler dev`.)
* The Worker's **Access** tab and the self-hosted application for a `workers.dev` hostname; One-time PIN sign-in; where the
  AUD tag and team domain are shown. (The token check itself was tested with tokens signed by a locally generated key in
  Cloudflare's own runtime.)
* Real hibernation of idle rooms on Cloudflare (tested by simulation; the local runtime does not hibernate on demand).
* Phones on a real mobile network; Safari (the app's own WebSocket address is spelled out in the CSP for older Safari).
* Behaviour when a free-plan limit is actually exceeded.
* Revoking a signed-in person's Access session (Zero Trust → My team → Users) — menu names from memory, not checked.

## 10. Things to keep in mind

* **Product data** (names, prices, links) is a November 2026 snapshot and will drift.
* **Regulations panel** is a design aid, not a permit review — it says so.
* **Licences:** Three.js (MIT), the fonts (OFL) and the other bundled libraries' licence files are in `vendor/`.
* **A GPL-licensed part (the DWG reader).** To open AutoCAD `.dwg` files, the hosted app includes GNU LibreDWG compiled
  to WebAssembly (the npm package `@mlightcad/libredwg-web` 0.8.8, in `vendor/dwg/`), which is licensed under the
  **GNU General Public License, version 3** (text: `vendor/dwg/LICENSE-GPL-3.0.txt`, also at
  https://www.gnu.org/licenses/gpl-3.0.html; its source: https://github.com/mlightcad/libredwg-web, from GNU LibreDWG,
  https://www.gnu.org/software/libredwg/). In plain words: when you make the app available to other people, this part
  comes under that licence's terms. The app's own source is already in your repository; keep the licence file and the
  source link (`vendor/dwg/README.md`) with the published files — both builds ship them. This is the licence's name and
  where to read it, not legal advice; if you want certainty about what distribution means for you, read the text or
  ask someone qualified. The rest of the app does not depend on it: DXF, PDF and pictures import without it.
* **Privacy:** everyone you invite sees the layout of your home in the projects you share with them.
