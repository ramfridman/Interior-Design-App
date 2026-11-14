# server/ — the Cloudflare backend for E7 House Designer

Everything Cloudflare-specific lives in this folder. The browser app (`index.html`, `src/`) has no dependency on it:
without a backend it behaves exactly as before.

| File | What it is |
| --- | --- |
| `wrangler.jsonc` | Worker configuration: static assets (`../dist/site`), the two Durable Object classes and their migration, `keep_vars` so dashboard variables survive deploys. |
| `src/worker.js` | The Worker: `/api/*` (same REST + WebSocket API as `dev/collab-server.mjs`, CONTRACT § 13), the entry page (CSP gets the host's `wss://` origin), every other path → static assets. |
| `src/auth.js` | Cloudflare Access JWT verification (`Cf-Access-Jwt-Assertion`, RS256 against the team's key set, audience, issuer, expiry) and the local-only `DEV_AUTH` switch. |
| `src/room-do.js` | `ProjectRoom` — one Durable Object per online project, wrapping `src/collab/room.js` unchanged; WebSocket Hibernation API. |
| `src/index-do.js` | `ProjectIndex` — one Durable Object holding every project's owner, members / roles, name, dates and who is in the room. |
| `src/kv.js` | The room's `{ get, put, delete }` storage over Durable Object storage, splitting big values (snapshots up to 32 MB) into pieces. |
| `package.json` | Pins `wrangler` (dev / deploy tool only — nothing from `node_modules` reaches the browser). |

## Run it locally (no Cloudflare account needed)

```sh
npm ci --prefix server                 # once: installs the pinned wrangler (with its local workerd runtime)
node dev/build-site.mjs                # writes dist/site (the Worker's static assets)
cd server && npx wrangler dev --var DEV_AUTH:1
```

Open `http://localhost:8787`. With `DEV_AUTH=1` the identity comes from an `X-Dev-User: name@example.com` header or a
`dev_user` cookie (set it in the browser's dev tools, or let the tests do it). `DEV_AUTH` is refused — the API answers 503
— when the Access variables are set, when `PRODUCTION=1`, or when the request is not for `localhost` / `127.0.0.1`.
Nothing else stands in for Access: `?as=`, `Cf-Access-Authenticated-User-Email` and the dev server's cookie trick are
ignored.

Tests: `node tests/collab.worker.test.mjs` (Node unit tests, then `wrangler dev` with the two-browser scenario, REST role
checks, two rooms, a runtime restart, and a second `wrangler dev` with Access configured against a local key server).

## Configuration (Worker variables — none are secrets)

| Variable | Value |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | `https://<your-team>.cloudflareaccess.com` (Zero Trust → Settings → Team name and domain) |
| `ACCESS_AUD` | The Access application's "Application Audience (AUD) Tag" |
| `DEV_AUTH` | Local testing only (`1`). Never set it in the dashboard. |
| `PRODUCTION` | Optional `1`: makes sure `DEV_AUTH` can never be honoured. |

If `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` are missing, `/api/*` answers 503 and the app runs as if there were no backend
(local projects only). Static files are served either way; Access itself keeps uninvited people out of the whole site.

## Design notes

* **Identity:** only the verified Access JWT. Key set fetched from `<team>/cdn-cgi/access/certs`, cached per isolate for an
  hour, refetched (at most once a minute) when a token names an unknown key (rotation).
* **Roles:** `owner / editor / viewer` per project in `ProjectIndex`; checked by the Worker on every REST route and before
  a room socket is opened; the room refuses viewers' changes; changing roles in the Share dialog reaches open sockets at
  once (and the attachment, so it survives hibernation); a removed person is told and disconnected.
* **Rooms:** `ProjectRoom` (one per project, `idFromName(projectId)`) runs `src/collab/room.js` — the same file the Node dev
  server runs. `room.receive` calls are chained one at a time. Sockets are accepted with `ctx.acceptWebSocket` (Hibernation
  API); each carries `{ connId, email, role, cid }` as its attachment. After eviction the constructor reloads the room from
  storage and re-joins every open socket without sending anything (no duplicate welcome). Covered by
  `tests/collab.worker.test.mjs` (Node, simulated hibernation) — `wrangler dev` does not hibernate on demand, so real
  hibernation is the one path not exercised against workerd itself.
* **Project index:** a second Durable Object, not KV or D1. KV is eventually consistent and its free plan allows only a
  small number of writes per day; D1 would need a database created by hand and its id pasted into the config. One
  Durable Object is strongly consistent, created by the migration on the first deploy, and on the free plan.
* **Cross-site protection:** WebSockets must carry `Origin` equal to the Worker's own origin; POST / PUT / DELETE with a
  foreign `Origin` are refused. Static files keep the `_headers` from `dev/build-site.mjs` (CSP, noindex, caching).
* **Light Worker:** the Worker never parses large bodies (Free plan: 10 ms CPU per request); project records and pictures
  are streamed to the Durable Object, which has its own, much larger CPU allowance.

## Free plan limits (checked 14 Nov 2026 in Cloudflare's documentation)

| Area | Workers Free | Source |
| --- | --- | --- |
| Worker requests | 100,000 / day (resets 00:00 UTC); over it: error 1027 (or 429 for asset routes that run the Worker) | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |
| Worker CPU | 10 ms per request; 128 MB memory; 50 subrequests per request | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Static assets | Free and unlimited requests (when they do not run the Worker); 20,000 files, 25 MiB per file; `_headers` up to 100 rules, 2,000 characters a line, not applied to Worker-made responses | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [`_headers`](https://developers.cloudflare.com/workers/static-assets/headers/) |
| Durable Objects | SQLite-backed only (the only kind on Free); 100,000 requests / day; 13,000 GB-s duration / day; 5 million rows read and 100,000 rows written / day; 5 GB stored in all; over a limit: those operations fail with an error until 00:00 UTC | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO storage | key + value ≤ 8 MB (hence `kv.js` pieces of ≤ 512 K characters); 100 classes; received WebSocket message ≤ 32 MiB | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| WebSockets | Opening one = 1 request; incoming messages billed 20 : 1; outgoing messages free; with the Hibernation API an idle room bills no duration; attachment ≤ 16,384 bytes | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| Workers Builds (Git deploys) | 3,000 build minutes / month, 1 build at a time, 20 min timeout; Worker name must equal `name` in `wrangler.jsonc` | [Builds limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/), [Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [Build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) |
| Access JWT | `Cf-Access-Jwt-Assertion` header; keys at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; RS256; check `aud` and `iss` | [Validate JWTs](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/) |

What that means here: a person editing sends roughly 20–40 room messages a second while dragging (presence + live
moves), billed as 1–2 requests a second; a typical evening of two people designing for two hours is a few thousand
requests and a few thousand rows written — far under the daily limits. The tightest limit is **100,000 rows written per
day** (each accepted change writes about 2–3 rows; a 4 MB sketch upload or a 32 MB snapshot writes one row per 512 K piece).
Not confirmed in the documentation pages read: whether the Zero Trust free plan's user cap still is 50 people.
