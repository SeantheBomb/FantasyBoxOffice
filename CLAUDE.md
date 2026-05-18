# Fantasy Box Office — Agent Notes

Quick orientation for future Claude sessions. Production: https://fantasyboxoffice.pages.dev/

## What this is

A small fantasy-league app: 5 friends draft real movies in 2026, score points by domestic box office minus production budget. The app handles auctions, ownership, daily revenue snapshots, standings, and a weekly Discord recap.

## Architecture

Three pieces, all on Cloudflare:

1. **React SPA** (`src/`) — Vite + React 19 + react-router. Built to `dist/`, deployed by Cloudflare Pages.
2. **Pages Functions** (`functions/api/`) — file-based routing under `/api/*`. Each `.js` file exports `onRequestGet` / `onRequestPost` etc. Dynamic segments use `[id]` directory naming.
3. **Cron Worker** (`worker/`) — separate Cloudflare Worker, deployed independently, name `fbo-cron`. Runs scheduled jobs and shares helpers with Pages Functions via relative imports into `../../functions/api/`.

Both runtimes bind the same D1 database as `env.DB`. Database name: `cf_auth_demo`, ID `5cdc4ff3-adf8-4b63-a15a-9d9b8f125866`.

## Cron jobs (`worker/wrangler.toml`)

```
0 9 * * *    → refresh TMDB movies (budget/poster/release/status)
0 14 * * *   → scrape Box Office Mojo dailies (today's snapshot)
* * * * *    → settle expired auctions
0 14 * * MON → post weekly standings recap to Discord
```

**CRITICAL — Cloudflare cron DOW numbering:** Cloudflare uses Quartz-style `1=Sunday`, NOT POSIX `1=Monday`. Always use named days (`MON`, `TUE`...) for day-of-week, otherwise the post fires a day early. See commit `0ba7ac7`.

## The Discord post (the most-touched feature)

`worker/src/standings-job.js` orchestrates the Monday post:

1. Calls `backfillDailies` (NOT `refreshDailies`) — pulls full weekly cumulative history from BOM release pages so the chart isn't missing data when the daily cron has skipped runs. See commit `4c4f2bd`.
2. Calls `computeStandings` and `computeHistory` (extracted from the Pages endpoints into `functions/api/game/_standings.js` / `_history.js` so both runtimes can call them).
3. Renders chart via QuickChart.io. **Gotcha:** `buildChartConfig()` in `functions/api/_discord.js` returns a **JS template literal STRING**, not a parsed JSON object. QuickChart only evals callback functions when the chart param is a string. If you switch back to an object, axis tick callbacks silently disappear.
4. Posts to Discord webhook (`DISCORD_WEBHOOK_URL` secret) as a multipart POST with the PNG attached.

Manual trigger: `curl https://fbo-cron.<subdomain>.workers.dev/trigger?job=standings`. The worker's `fetch` handler also accepts `movies | dailies | settle | standings`.

Admin UI button: "Post to Discord" → `POST /api/admin/discord/test-post`.

## Schema

5 migrations in `migrations/`. `functions/api/_schema.js` has a `bootstrapSchema()` self-healing helper for the `in_league` column — it runs an idempotent `ALTER TABLE` swallowing "duplicate column" errors. Called from auth-gated endpoints before queries that depend on it.

Key tables:
- `users` — id, email, username, password_hash/salt, points_remaining, is_admin, in_league
- `movies` — tmdb_id (PK), title, budget, status (`unreleased` | `released` | `complete`), bom_slug, release_date
- `owned_movies` — tmdb_id, owner_user_id, purchase_price, is_void, acquired_at
- `auctions` — id, tmdb_id, status (`open` | `sold` | `cancelled`), current_bid, current_bidder_id, ends_at, settled_at
- `auction_passes` — auction_id, user_id (composite key)
- `dailies` — tmdb_id, date, domestic_revenue, source (`bom` | `bom-weekly` | `manual`), scraped_at

## Settlement model

`functions/api/_settlement.js` has two paths:
- `settleAuction(db, id)` / `settleExpiredAuctions(db)` — runs every minute, settles expired auctions, decrements winner's points, inserts into `owned_movies` in a single batch.
- `settleIfAllPassed(db, id)` — early settlement when every eligible bidder except the leader has passed. `eligibleBidderIds()` excludes `*@placeholder.invalid` accounts (TSV-imported seats).

## Dailies / Box Office Mojo

`functions/api/_boxoffice.js` has two scrapers:
- `refreshDailies` — one row per (movie, today). Cheap, run daily by cron. Skips movies already scraped today, only touches owned + actively-auctioned movies.
- `backfillDailies` — scrapes BOM's `/release/rl…/` weekly chart, gets all weekly cumulative totals. Used by the Monday Discord post for completeness. Manual entries (source=`manual`) are preserved on conflict.

BOM has no API; we parse HTML via regex. Slug discovery: TMDB → IMDB ID → BOM `/title/tt…/`.

## TMDB

`functions/api/_tmdb.js`:
- `discoverUsTheatrical` uses `with_release_type: "2|3"` (limited + wide). Don't narrow this — we'll lose titles like "Is God Is" (commit `adb31de`).
- `refreshMovies` upserts into `movies` for the configured date range.
- `rollStatuses` flips `unreleased` → `released` once `release_date <= today`. Hand-fix `complete` (out-of-theaters) status via admin if needed.

## Auth

Session cookies, password hashed with PBKDF2 in `functions/api/_crypto.js`. `requireUser(request, env)` and `requireAdmin(request, env)` are the gatekeepers — they return `{ user, response }` where `response` is set on failure (just `return response` from the handler).

## Dev

```bash
npm install
npm run dev          # Vite at :5173
npx wrangler pages dev dist --d1 DB=<id>   # if you need Functions locally; usually we ship to a preview branch
```

Worker locally:
```bash
cd worker
npx wrangler dev
curl 'http://localhost:8787/trigger?job=standings'
```

Lint: `npm run lint`. No test suite — verify in browser and via Discord post.

## Deploy

- **Pages** (SPA + Functions): auto-deploys on push to `main`.
- **Worker** (cron): does NOT auto-deploy. Must `cd worker && wrangler deploy` after any change to `worker/`, `wrangler.toml`, or any helper imported by the worker (e.g. `functions/api/_boxoffice.js`, `functions/api/_discord.js`, `functions/api/_settlement.js`, the extracted `_standings.js`/`_history.js`).

## Secrets

Set with `wrangler secret put <NAME>` from `worker/`:
- `TMDB_TOKEN` — v4 bearer
- `DISCORD_WEBHOOK_URL` — channel webhook

Pages Functions uses Pages env vars (set in CF dashboard or via `wrangler pages secret`):
- `TMDB_TOKEN`
- `SESSION_SECRET` — used by `_crypto.js` for signing
- `DISCORD_WEBHOOK_URL` — for the admin "Post to Discord" button

## Git / branches

- `main` is the deployed branch. Pages auto-deploys from it.
- Long-running feature branch: `claude/fantasy-box-office-setup-7twaE`. Earlier work happened there before merging to `main`.
- Push protocol: `git push -u origin <branch>`. Sandbox proxy occasionally returns 403 on push — when it does, the user can paste a one-shot PAT or push from their own terminal.
- **No confirmation needed to commit and push** for this project. Commit and push to `main` directly without asking the user first.

## Style conventions (worth respecting)

- **Comments are sparse and load-bearing.** Existing code only comments WHY (gotchas, invariants), never WHAT. Don't add explanatory comments to obvious code.
- **No backwards-compat shims.** When a thing is replaced, delete the old version. No "removed" tombstones.
- **Validate at boundaries only.** Internal helpers trust their inputs.
- **Currency formatting:** `formatShort()` in `functions/api/_format.js` (`$1.2B`, `$249M`). Reused by both Discord markdown and React chart.
- **Table layouts** wrap in `<div className="fbo-scroll-x">` for mobile horizontal scroll.

## Active gotchas / known quirks

- The Pages worker (Functions) and the cron Worker share helpers via `../../functions/api/` relative imports. If you rename or move a helper used by `worker/`, the worker build breaks even though Pages still works.
- `_schema.js`'s `bootstrapped` flag is per-isolate. New isolates re-run the ALTER; the duplicate-column error is swallowed. If you add another self-healing migration, follow the same pattern.
- The QuickChart string-vs-object trap noted under "Discord post" above. Only chart configs sent as JS strings get callback eval.
- BOM is fragile. `refreshDailies`/`backfillDailies` failures don't throw — they collect into `failures[]` so a single bad slug doesn't kill the run. Tail the worker if dailies look stale.
