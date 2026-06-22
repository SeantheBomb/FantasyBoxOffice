# Fantasy Box Office — Agent Notes

Quick orientation for future Claude sessions. Production: https://fantasyboxoffice.pages.dev/

## What this is

A small fantasy-league app: 5 friends draft real movies in 2026, score points by domestic box office minus production budget. The app handles auctions, ownership, daily revenue snapshots, standings, and a weekly Discord recap.

## Architecture

Three pieces, all on Cloudflare:

1. **React SPA** (`src/`) — Vite + React 19 + react-router. Built to `dist/`, deployed by Cloudflare Pages.
2. **Pages Functions** (`functions/api/`) — file-based routing under `/api/*`. Each `.js` file exports `onRequestGet` / `onRequestPost` etc. Dynamic segments use `[id]` directory naming.
3. **Cron Worker** (`worker/`) — separate Cloudflare Worker, deployed independently, name `fantasy-box-office-weekly-report`. Runs scheduled jobs and shares helpers with Pages Functions via relative imports into `../../functions/api/`.

Both runtimes bind the same D1 database as `env.DB`. Database name: `cf_auth_demo`, ID `5cdc4ff3-adf8-4b63-a15a-9d9b8f125866`.

## Cron jobs (`worker/wrangler.toml`)

```
0 9 * * *     → refresh TMDB movies (budget/poster/release/status)
0 14 * * *    → scrape Box Office Mojo dailies (today's snapshot)
* * * * *     → settle expired auctions
30 14 * * MON → self-contained weekly standings post (backfill + score + post)
0 12 * * THU  → last-call betting reminder in #movie-chat
```

**CRITICAL — Cloudflare cron DOW numbering:** Cloudflare uses Quartz-style `1=Sunday`, NOT POSIX `1=Monday`. Always use named days (`MON`, `TUE`...) for day-of-week, otherwise the post fires a day early. See commit `0ba7ac7`.

## The Monday standings post (the most-touched feature)

`worker/src/standings-job.js` orchestrates the Monday post as a **self-contained job** — it produces all the data it needs before consuming it, eliminating timing dependencies on other crons:

1. **Backfill** — `backfillDailies()` pulls full weekly cumulative history from BOM release pages. Always runs; never skipped.
2. **Daily refresh** — `refreshDailies()` gets today's cumulative BOM snapshot inline, eliminating the race with the 14:00 daily cron.
3. **Score predictions** — `autoScoreWeekendPicks()` finds unscored movies from the past 3 days, gets their BOM opening weekend gross, and calls `scoreMovie()`. Points are written to DB first; Discord post is a separate step so a webhook failure doesn't mask a successful score.
4. **Refresh budgets** — `refreshNewReleaseBudgets()` updates TMDB budgets for movies that opened in the past week.
5. **Standings + chart** — `computeStandings()` and `computeHistory()` run in parallel, then `buildChartConfig()` renders via QuickChart.io. **Gotcha:** `buildChartConfig()` returns a **JS template literal STRING**, not a parsed JSON object. QuickChart only evals callback functions when the chart param is a string.
6. **Post to Discord** — multipart POST with the PNG attached + overflow text messages.
7. **Weekend announcement** — if `weekend_movies` has rows for `weekend_date >= today`, posts the upcoming lineup with poster embeds.

Every step is logged with `[standings]` prefix and timing. The final log line is a single JSON summary: `[standings] DONE {...}`.

Manual trigger: `curl https://fantasy-box-office-weekly-report.sean-feeser.workers.dev/trigger?job=standings`.

Admin UI button: "Post to Discord" → `POST /api/admin/discord/test-post`.

## Local test for the standings job

```bash
node --loader ./worker/test/loader.mjs ./worker/test/run-standings-local.mjs
```

Seeds an in-memory SQLite DB (via `better-sqlite3`), stubs `fetch` to capture Discord/BOM/TMDB/QuickChart calls, runs the full `runStandingsPost()` flow, and validates: scoring correctness (points 3/2/1), standings posted, chart rendered, announcement posted. Run this before deploying changes to the standings job.

## Schema

9 migrations in `migrations/`. `functions/api/_schema.js` has a `bootstrapSchema()` self-healing helper for columns added after initial migration — it runs idempotent `ALTER TABLE` statements, swallowing "duplicate column" errors. Called from auth-gated endpoints before queries that depend on those columns.

Key tables:
- `users` — id, email, username, password_hash/salt, points_remaining, is_admin, in_league
- `movies` — tmdb_id (PK), title, budget, status (`unreleased` | `released` | `complete`), bom_slug, release_date
- `owned_movies` — tmdb_id, owner_user_id, purchase_price, is_void, acquired_at
- `auctions` — id, tmdb_id, status (`open` | `sold` | `cancelled`), current_bid, current_bidder_id, ends_at, settled_at
- `auction_passes` — auction_id, user_id (composite key)
- `dailies` — tmdb_id, date, domestic_revenue, source (`bom` | `bom-weekly` | `manual`), scraped_at
- `weekend_movies` — tmdb_id, weekend_date (composite PK). Admin must populate before Monday for the announcement.
- `weekend_picks` — discord_user_id, tmdb_id, estimate (integer millions), weekend_date, points_awarded
- `weekend_results` — tmdb_id, weekend_date, actual_gross, scored_at

## Points system

`users.points_remaining` is the **one and only points pool** — it serves double duty:
1. **Auction currency** — decremented when a player wins a movie auction.
2. **Prediction earnings** — incremented when `scoreMovie()` awards points for weekend pick accuracy.

There is no separate "prediction points" balance. Winning predictions directly funds auction bids.

`scoreMovie()` in `functions/api/_weekend-scoring.js` uses a delta-based update so re-scoring is idempotent: it fetches `COALESCE(points_awarded, 0)` as `old_points` before updating, then applies `new_points - old_points` to `users.points_remaining`. Re-scoring the same result is a no-op; correcting a score adjusts the balance up or down by exactly the difference.

## Settlement model

`functions/api/_settlement.js` has two paths:
- `settleAuction(db, id)` / `settleExpiredAuctions(db)` — runs every minute, settles expired auctions, decrements winner's points, inserts into `owned_movies` in a single batch.
- `settleIfAllPassed(db, id)` — early settlement when every eligible bidder except the leader has passed. `eligibleBidderIds()` excludes `*@placeholder.invalid` accounts (TSV-imported seats).

## Dailies / Box Office Mojo

`functions/api/_boxoffice.js` has two scrapers:
- `refreshDailies` — one row per (movie, today). Cheap, run daily by cron. Skips movies already scraped today, only touches owned + actively-auctioned movies.
- `backfillDailies` — scrapes BOM's `/release/rl…/` weekly chart, gets all weekly cumulative totals. Used by the Monday standings job for completeness. Manual entries (source=`manual`) are preserved on conflict.

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

Lint: `npm run lint`. Standings test: see "Local test" section above.

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
- The shared helpers use extensionless imports (e.g. `from "./_tmdb"`) which Cloudflare resolves automatically but Node ESM does not. The local test harness uses a custom loader (`worker/test/loader.mjs`) to bridge this.
