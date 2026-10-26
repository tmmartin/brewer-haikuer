# Brewer Haikuer

Static archive of @brewer_haikuer's Milwaukee Brewers game-recap haiku (2009–2024).

- `index.html`, `styles.css`, `app.js`: the site (no build step)
- `data/haiku.json`: haiku database, matched to the MLB schedule
- Game summaries load live from the MLB Stats API in the browser

Run locally: `python3 -m http.server`, then open http://localhost:8000

Launched: the `noindex` tag has been removed.

## Reader submissions (Worker + D1)

- `worker/index.js`: API (`/api/submit`, `/api/approved`, `/api/admin/*`) and the `/admin` gate. Everything else is served as static files.
- `submit.html`: public form (Cloudflare Turnstile spam check, rate limited, honeypot). Submissions land as `pending`.
- `admin.html` (served at `/admin`): review queue. Edit, pick the game, Approve / Reject / Unpublish.
- `schema.sql`: D1 table. Approved haiku are served from D1 and merged into the archive in the browser (`mergeSubmitted` in `app.js`); `data/haiku.json` is not modified.
- Admin routes require a Cloudflare Access login. The Worker verifies the Access JWT itself, so a missing Access policy fails closed.

One-time setup:
1. `npx wrangler d1 create brewer-haikuer`, then paste the `database_id` into `wrangler.jsonc`.
2. `npm run db:remote` to create the table.
3. Turnstile widget (dashboard → Turnstile) for `brewerhaikuer.com`; put the **site key** in `wrangler.jsonc` (`TURNSTILE_SITE_KEY`) and add the **secret** as a Worker secret named `TURNSTILE_SECRET`. Also add a secret `IP_SALT` (any random string).
4. Zero Trust → Access → Applications → self-hosted, covering `brewerhaikuer.com/admin*` and `brewerhaikuer.com/api/admin/*`, policy: your email only. Put the team domain (`xxxx.cloudflareaccess.com`) and the application's AUD tag in `wrangler.jsonc` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`).

Local dev: create `.dev.vars` with Cloudflare's Turnstile test keys and `DEV_ADMIN_EMAIL=dev@local` (never set that in production), `npm run db:local`, `npm run dev`.
