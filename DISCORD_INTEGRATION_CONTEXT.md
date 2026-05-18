# Fantasy Box Office — Discord Integration Context

This document summarizes all Discord-related features built in May 2026 for handoff to another session.

---

## Overview

A weekend box office prediction game was added to FBO. Players bet on how much each opening-weekend movie will earn. Bets can be placed via Discord slash command (`/bet`) or the new `/betting` page on the website.

---

## Database Schema (migrations applied to D1)

### `migrations/0007_weekend_picks.sql`
Three new tables:

```sql
CREATE TABLE IF NOT EXISTS weekend_movies (
  tmdb_id INTEGER NOT NULL,
  weekend_date TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, weekend_date),
  FOREIGN KEY (tmdb_id) REFERENCES movies(tmdb_id)
);

CREATE TABLE IF NOT EXISTS weekend_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  estimate INTEGER NOT NULL,       -- stored as integer MILLIONS (5 = $5M)
  weekend_date TEXT NOT NULL,
  points_awarded INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(discord_user_id, tmdb_id, weekend_date)
);

CREATE TABLE IF NOT EXISTS weekend_results (
  tmdb_id INTEGER NOT NULL,
  weekend_date TEXT NOT NULL,
  actual_gross INTEGER NOT NULL,   -- raw dollar amount
  scored_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (tmdb_id, weekend_date)
);
```

### `migrations/0008_discord_user_id.sql`
```sql
ALTER TABLE users ADD COLUMN discord_user_id TEXT;
```

Both migrations have been applied directly to the production D1 database.

---

## Discord App Credentials

- **App ID:** `1505968596478722230`
- **Public Key:** `c606c11...` (full key stored in `DISCORD_PUBLIC_KEY` hardcoded in `functions/api/discord/interactions.js`)
- **Guild ID:** `1457760237913247917`
- **Bot token:** stored as `DISCORD_BOT_TOKEN` Pages secret (used for slash command registration only)

The bot has been invited to the server with `bot + applications.commands` scope.

---

## Slash Commands Registered

`/bet` — registered globally to the guild.
- `movie` — string autocomplete (searches active weekend lineup)
- `estimate` — string (must be format `$#M`, e.g. `$45M`)

---

## Webhooks

Two webhooks in use (set as Pages secrets and Worker secrets):

| Secret Name | Channel | Used for |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | standings channel | Weekly standings recap (existing) |
| `DISCORD_GAME_FEED_WEBHOOK_URL` | `#game-feed` | All betting/predictions posts: opening weekend announcements, `/bet` public posts, last-call reminder, scoring results |
| `DISCORD_GAME_FEED_WEBHOOK_URL` | `#game-feed` | Scoring results with `<@mention>` and points |

---

## New Backend Files

### `functions/api/discord/interactions.js`
Discord Interactions endpoint. Handles:
- Ed25519 signature verification using `DISCORD_PUBLIC_KEY`
- `/bet` command with autocomplete (Type 4 response)
- Bet validation: integer millions only (`/^(\d+)M$/i`), positive integer
- Duplicate estimate check (no two users can bet the same amount on the same movie)
- Duplicate user check (one bet per user per movie)
- Betting window: closes when `weekend_date <= date('now')` (movies already in theaters)
- On success: posts `🎲 <@user_id> bet **$45M** on **Movie Title**` to `#movie-chat`
- Returns ephemeral confirmation to the user

### `functions/api/_weekend-scoring.js`
Shared scoring logic used by both the admin endpoint and the Monday cron:
- `scoreMovie(db, { tmdb_id, weekend_date, actual_gross })` — upserts `weekend_results`, ranks picks by closest estimate, awards points `[3, 2, 1, 0, ...]`, updates `points_awarded`, builds Discord content with `<@discord_user_id>` mentions and abstentions list

### `functions/api/admin/weekend/score.js`
- `GET` — returns active weekend date, movies, all picks (with `id` for editing), abstentions
- `POST` — calls `scoreMovie()`, posts result to `DISCORD_GAME_FEED_WEBHOOK_URL`

### `functions/api/admin/weekend/picks.js`
Admin CRUD for picks:
- `PATCH` — update estimate by pick id
- `DELETE` — remove pick by id
- `POST` — manually create a pick on behalf of a player (uses `discord_user_id` to look up their username)

### `functions/api/admin/weekend/movies.js`
- `GET` — returns lineup for active/specified weekend
- `POST` — clears and re-inserts the movie lineup for a given `weekend_date`

### `functions/api/admin/weekend/announce.js`
Manual trigger for the opening weekend announcement post to `#movie-chat`. Calls `postWeekendAnnouncement()` from `functions/api/_discord.js`.

### `functions/api/admin/weekend/last-call.js`
Manual trigger for the Thursday last-call post. Imports `runLastCallPost` from the worker.

### `functions/api/betting/current.js`
Public GET — returns the active/recent weekend (within last 7 days or upcoming) with all picks and `my_pick` identified server-side from session cookie. Includes `is_open`, `is_in_league` flags.

### `functions/api/betting/history.js`
Public GET — returns all past weekends with movies, picks, and `actual_gross` results. Newest first.

### `functions/api/betting/index.js`
POST — place a bet from the website (requires auth + `in_league`). Validates integer millions, blocks duplicates, posts to `#movie-chat` if user has `discord_user_id` linked.

---

## Modified Files

### `functions/api/_discord.js`
Added `postWeekendAnnouncement(webhookUrl, { weekendDate, movies })`:
- Posts `@everyone` + `## 🎬 Opening Weekend — May 22` with movie embeds (poster, title, owner)
- `@everyone` must be on its own line before the `##` heading (Discord parses them separately)

### `functions/api/admin/users/index.js`
Added `u.discord_user_id` to the SELECT query so it appears in the users list.

### `functions/api/admin/users/[id]/profile.js`
Added `discord_user_id` field handling (nullable, set to NULL if empty string submitted).

---

## Worker Changes (`worker/`)

### `worker/src/standings-job.js`
Updated Monday job sequence:
1. `autoScoreWeekendPicks(env)` — auto-scores any weekend from the past 3 days that has `domestic_revenue` in `dailies` but no `weekend_results` entry yet. Posts to `#game-feed`.
2. `backfillDailies` (existing)
3. `computeStandings` + `computeHistory` → chart → post standings to Discord
4. After standings: queries upcoming `weekend_movies`, calls `postWeekendAnnouncement` to `#movie-chat`

### `worker/src/last-call-job.js` (new)
Thursday reminder: posts `@everyone 📣 Last call!` with movie list to `#movie-chat`.

### `worker/wrangler.toml`
Added Thursday cron:
```toml
crons = ["0 9 * * *", "0 14 * * *", "* * * * *", "0 14 * * MON", "0 12 * * THU"]
```
**Note:** Cloudflare uses Quartz-style DOW numbering (`1=Sunday`). Always use named days (`MON`, `THU`) to avoid off-by-one errors.

Worker secrets (set via `wrangler secret put` from `worker/`):
- `DISCORD_GAME_FEED_WEBHOOK_URL`
- `DISCORD_GAME_FEED_WEBHOOK_URL`

---

## Frontend Changes

### `src/pages/Betting.jsx` (new)
Full `/betting` page:
- Active weekend: movie cards with poster, owner, release date, all bets, actual gross when scored, ranked results with place + points
- Bet form for in-league logged-in users (integer millions input, duplicate/validation errors shown inline)
- "Betting Open / Betting Closed / Results In" status badge
- Past weekends section with full history in reverse chronological order
- Unauthenticated users see all bets but get a "Sign in" prompt instead of the form

### `src/Layout.jsx`
Added "Predictions" nav link (always visible, no auth gate) pointing to `/betting`.

### `src/main.jsx`
Added `<Route path="/betting" element={<Betting />} />`.

### `src/api.js`
New exports:
```js
apiBettingCurrent()
apiBettingHistory()
apiBet(tmdbId, estimate)
apiAdminWeekendScore(weekendDate)
apiAdminScoreMovie(weekendDate, tmdbId, actualGross)
apiAdminWeekendMovies(weekendDate)
apiAdminSetWeekendMovies(weekendDate, tmdbIds)
apiAdminPostWeekendAnnouncement()
apiAdminPostLastCall()
apiAdminUpdatePick(id, estimate)
apiAdminDeletePick(id)
apiAdminCreatePick(pick)
apiLinkDiscord(discordUserId)   // added by linter/other session
```

---

## Admin Panel Changes (`src/pages/Admin.jsx`)

A `WeekendPanel` component was added with:
- **Configure lineup:** date input, movie search from catalog, lineup list, "Save lineup" / "Post announcement" / "Post last-call" buttons
- **Per-movie picks:** table with inline Edit (estimate in millions) / Delete, abstentions list, "+ Add pick" row (player dropdown + estimate)
- **Score form:** actual gross input + "Score & post to #game-feed"
- **Users table:** added Discord ID column showing `<code>` tag or `—`
- **Edit user:** prompts for Discord User ID (admin gets it from right-click → Copy User ID in Discord)

---

## Data Notes

- **Estimates storage:** Discord bot stores integer millions (`5` = `$5M`). Admin-entered picks may have been stored as raw dollar amounts (`5000000` = `$5M`). The `/betting` page handles both via:
  ```js
  function fmtEstimate(v) {
    return v >= 1_000_000 ? fmtGross(v) : `$${v}M`;
  }
  ```
- **User identity:** Players with a linked `discord_user_id` use that as their identifier. Website-only users get `"fbo_" + user.id` as a synthetic discord_user_id in `weekend_picks`.
- **Betting window:** Closes when `weekend_date <= date('now')` (strict — movies in theaters on Friday means betting closes Thursday night UTC).
- **Auto-scoring timing:** `rollStatuses` at 9am UTC marks movies `released`; `backfillDailies` in Monday's standings job at 2pm UTC has the opening weekend gross; `autoScoreWeekendPicks` then finds the first `dailies` entry within 7 days of `weekend_date` as the opening weekend gross.
- **Worker deploy:** After any change to `worker/` or helpers it imports, must run `cd worker && wrangler deploy` manually. Pages auto-deploys from `main`.
