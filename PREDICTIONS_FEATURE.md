# Fantasy Box Office — Weekend Predictions Feature

Complete design, outcome, and implementation reference for the handoff agent.

Production: https://fantasyboxoffice.pages.dev/betting

---

## Design Goals

Five friends play a season-long fantasy league based on real domestic box office results. The predictions feature adds a second layer of weekly competition:

1. **Each week**, an admin configures a lineup of movies opening that weekend.
2. **Players bet** on how much each movie will earn on its opening weekend, in integer millions (e.g. `$45M`). One bet per player per movie. No two players can pick the same amount for the same movie.
3. **Betting closes** automatically when movies hit theaters (Friday/Saturday). No late entries.
4. **On Monday**, the cron job auto-scores picks using opening weekend gross pulled from Box Office Mojo, posts results to Discord with `@mentions` and points awarded, then immediately announces next weekend's lineup.
5. **Points** are awarded `[3, 2, 1, 0]` by closest estimate. Closest = 1st place = 3 points, etc. Ties broken by sort order (stable). **These points go directly into `users.points_remaining` — the same pool used to bid on movies at auction.**
6. **Abstentions** (no bet placed) earn 0 points and are called out by name in the results post.
7. The `/betting` page on the website gives the same experience to users who prefer not to use Discord.

---

## Expected Outcomes / Weekly Flow

### Monday (2pm UTC) — automated via cron
1. Auto-score last weekend's picks (if BOM data is available).
2. Post scoring results to `#game-feed` with ranked `@mentions` and cumulative totals.
3. Backfill BOM dailies for all tracked movies.
4. Post weekly standings recap + profit chart to the standings channel.
5. Post opening weekend announcement for the *next* upcoming lineup to `#game-feed`.

### Thursday (12pm UTC) — automated via cron
- Post a last-call reminder to `#game-feed`.
- `@mention` only players who **haven't placed all their bets yet**.
- If everyone has already bet, the post is skipped entirely.

### Friday (midnight UTC) — automatic enforcement
- Betting window closes. `weekend_date > date('now')` becomes false, so the `/bet` command and website form both reject new picks with a "movies are already in theaters" message.

### Admin (any time via Admin panel)
- Configure the upcoming lineup (which movies, which weekend date).
- View, edit, delete, and manually add picks for any player.
- Manually score a movie (if auto-scoring fails due to missing BOM data).
- Manually trigger the announcement or last-call post.

---

## Data Model

### Tables

```sql
-- Which movies are in each weekend's lineup
weekend_movies (
  tmdb_id     INTEGER NOT NULL REFERENCES movies(tmdb_id),
  weekend_date TEXT NOT NULL,   -- ISO date: the Friday/Saturday of release
  PRIMARY KEY (tmdb_id, weekend_date)
)

-- Player picks
weekend_picks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id  TEXT NOT NULL,   -- real Discord ID, or "fbo_<user.id>" for website-only users
  discord_username TEXT NOT NULL,   -- display fallback; site queries COALESCE(users.username, discord_username)
  tmdb_id          INTEGER NOT NULL,
  estimate         INTEGER NOT NULL, -- INTEGER MILLIONS: 45 = $45M
  weekend_date     TEXT NOT NULL,
  points_awarded   INTEGER,         -- NULL until scored; 3/2/1/0
  created_at       TEXT DEFAULT (datetime('now')),
  UNIQUE(discord_user_id, tmdb_id, weekend_date)
)

-- Scoring results (one row per movie per weekend once scored)
weekend_results (
  tmdb_id      INTEGER NOT NULL,
  weekend_date TEXT NOT NULL,
  actual_gross INTEGER NOT NULL,  -- RAW dollar amount (e.g. 45000000 = $45M)
  scored_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (tmdb_id, weekend_date)
)

-- Added to existing users table:
users.discord_user_id TEXT  -- nullable; admin sets this via the Users panel
```

### Key data invariant
`weekend_picks.estimate` is always stored as **integer millions** (5 = $5M). `weekend_results.actual_gross` is always a **raw dollar amount** (5000000 = $5M). The display layer converts accordingly:
```js
// estimate display (Betting.jsx)
function fmtEstimate(v) {
  return v >= 1_000_000 ? fmtGross(v) : `$${v}M`;
  // handles legacy admin-entered raw-dollar picks gracefully
}
```

### User identity
- **Discord players**: `discord_user_id` = their real Discord snowflake ID. Bet via `/bet` slash command or the website (if they've linked their account).
- **Website-only players**: `discord_user_id` = `"fbo_" + users.id`. Their `discord_username` is already their FBO username; they won't receive `@mentions` in Discord results/last-call posts.
- **Linking**: Admin sets a user's `discord_user_id` in the Users panel by right-clicking them in Discord → Copy User ID.

---

## Backend Files

### `functions/api/discord/interactions.js`
The Discord Interactions endpoint (registered in the Discord developer portal as the interactions URL).

- **Ed25519 signature verification** using `DISCORD_PUBLIC_KEY` hardcoded at the top of the file.
- Handles `PING` (type 1), slash command (type 2), and autocomplete (type 4).
- **`/bet` command**:
  - `movie` param: string with autocomplete. Returns matching movies from the active weekend lineup.
  - `estimate` param: string. Validated by `parseEstimate()` — must match `/^(\d+)M$/i`. Decimals rejected. Raw numbers rejected.
  - Active weekend: `SELECT MIN(weekend_date) FROM weekend_movies WHERE weekend_date > date('now')` — strict, so betting closes midnight UTC on release day.
  - Duplicate estimate check: no two players can pick the same dollar amount for the same movie/weekend.
  - On success: inserts into `weekend_picks`, then posts a public `🎲 <@user_id> bet **$45M** on **Movie**` message to `#game-feed`.
  - Returns an ephemeral confirmation to the bettor.
  - If betting closed: returns ephemeral "Betting is closed — movies are already in theaters."

### `functions/api/_weekend-scoring.js`
Shared scoring logic called by both the admin endpoint and the Monday cron.

```
scoreMovie(db, { tmdb_id, weekend_date, actual_gross }) → { title, actual_gross, scored, abstentions, content }
```

1. Upserts `weekend_results`.
2. Fetches all picks for this movie/weekend, ordered by `ABS(estimate - actual_gross) ASC`.
3. Awards points `[3, 2, 1, 0, 0, ...]` in order.
4. Batch-updates `weekend_picks.points_awarded`.
5. Fetches cumulative totals for all involved players.
6. Builds a Discord content string with `<@discord_user_id>` mentions, place labels, points earned, and running totals. Abstentions listed at the end.

**Points system:** `POINTS = [3, 2, 1]` — index 0 gets 3, index 1 gets 2, index 2 gets 1, all others get 0. After updating `points_awarded`, `scoreMovie` also updates `users.points_remaining` by the delta (new − old) so re-scoring correctly adjusts rather than double-counting.

### `functions/api/betting/current.js`
Public GET — active weekend data for the `/betting` page.

- Finds the earliest `weekend_date >= date('now', '-7 days')` (covers current + very recent past).
- Returns `{ weekend, weekend_date, is_open, is_in_league, movies }`.
- `is_open = weekend_date > today` (strict).
- `is_in_league` derived from the session user's `in_league` column.
- Each movie includes `picks[]` and `my_pick` (identified server-side from session cookie).
- Picks query: `LEFT JOIN users u ON u.discord_user_id = wp.discord_user_id` — uses FBO username when available, falls back to `discord_username`.

### `functions/api/betting/history.js`
Public GET — all past weekends for the history section of `/betting`.

- Returns all `weekend_date < today`, newest first.
- Per weekend: movies with `actual_gross` from `weekend_results`, picks sorted by `points_awarded DESC`.
- Same FBO username join as `current.js`.

### `functions/api/betting/index.js`
POST — place a bet from the website.

- Requires session auth + `in_league = 1`.
- Validates: positive integer, active lineup entry, no existing pick by this user, no duplicate estimate.
- `discord_user_id` = `user.discord_user_id ?? "fbo_" + user.id`.
- If user has a real `discord_user_id`: posts public bet announcement to `#game-feed`.

### `functions/api/admin/weekend/movies.js`
- `GET`: returns lineup for active or specified `weekend_date`.
- `POST`: replaces entire lineup for a weekend — deletes existing rows, inserts new ones.

### `functions/api/admin/weekend/score.js`
- `GET`: returns weekend date, movies, all picks (with `id` for inline editing), and abstentions per movie.
- `POST`: calls `scoreMovie()`, posts result content to `#game-feed`.

### `functions/api/admin/weekend/picks.js`
Admin CRUD for individual picks:
- `PATCH`: update `estimate` by pick `id`.
- `DELETE`: remove pick by `id`.
- `POST`: create a pick on behalf of a player (looks up their FBO username from `discord_user_id`).

### `functions/api/admin/weekend/announce.js`
POST — manually trigger the opening weekend announcement to `#game-feed`. Queries movies for the next upcoming weekend and calls `postWeekendAnnouncement()`.

### `functions/api/admin/weekend/last-call.js`
POST — manually trigger the Thursday last-call post. Imports `runLastCallPost` from the worker.

---

## Worker Files

### `worker/src/last-call-job.js`
Called by the Thursday cron (`0 12 * * THU`) and the admin manual-trigger endpoint.

- Finds the next upcoming weekend.
- Queries in-league users with a `discord_user_id` who have **fewer picks than movies in the lineup**.
- If everyone has bet: returns `{ skipped }` with no Discord post.
- Otherwise: `@mentions` only the players who still owe picks, lists all movies.

### `worker/src/standings-job.js` — `autoScoreWeekendPicks(env)`
Called at the start of the Monday standings job before the main post.

- Finds movies from the past 3 days with no `weekend_results` entry.
- Looks up opening weekend gross from `dailies` (first entry within 7 days of `weekend_date`).
- Calls `scoreMovie()` and posts results to `#game-feed`.
- Falls back gracefully: if no BOM data yet, logs the error and continues to next movie.

---

## Frontend

### `src/pages/Betting.jsx`
Route: `/betting`. Publicly accessible — no login required to view.

**Current weekend section:**
- Movie cards in a responsive grid (min 280px).
- Each card: poster thumbnail, title, owner, release date, actual gross badge (when scored).
- Bets table: username | estimate | points (when scored). 1st/2nd/3rd place labels shown after scoring. User's own row highlighted gold.
- **Bet form** shown only when: `is_open && is_in_league && !my_pick`. Number input (in millions) + "Place Bet" button.
- Status badge: green "Betting Open" / grey "Betting Closed" / blue "Results In".

**Past weekends section:**
- Identical card layout, always read-only.
- Picks sorted by `points_awarded DESC` (ranked order).

**State management:**
- `refreshKey` counter triggers `useEffect` re-fetch after a successful bet (avoids stale data).
- `is_in_league` returned from the server (not computed client-side) since the client doesn't have that field on the session user object.

### `src/Layout.jsx`
"Predictions" nav link added — always visible regardless of auth state.

---

## Discord Configuration

| Item | Value |
|---|---|
| App ID | `1505968596478722230` |
| Public Key | `c606c11537ec649f897e142db70be33fe1432084920be1a0f18ba9d694609be7` |
| Guild ID | `1457760237913247917` |
| Bot token | Stored as `DISCORD_BOT_TOKEN` Pages secret — retrieve from Cloudflare dashboard |
| Interactions URL | `https://fantasyboxoffice.pages.dev/api/discord/interactions` |

## Secrets Required

| Secret | Set on | Used for |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | Pages + Worker | Weekly standings recap (existing feature) |
| `DISCORD_GAME_FEED_WEBHOOK_URL` | Pages + Worker | All predictions posts: bets, announcements, last-call, results |
| `DISCORD_PUBLIC_KEY` | hardcoded in `interactions.js` | Ed25519 signature verification |
| `TMDB_TOKEN` | Pages + Worker | Movie data refresh |
| `SESSION_SECRET` | Pages | Auth cookie signing |

> `DISCORD_MOVIE_CHAT_WEBHOOK_URL` was an earlier name for the predictions webhook — it has been fully replaced by `DISCORD_GAME_FEED_WEBHOOK_URL` and can be deleted.

---

## Cron Schedule (worker/wrangler.toml)

```toml
crons = [
  "0 9 * * *",       # Refresh TMDB movies
  "0 14 * * *",      # Scrape BOM dailies
  "* * * * *",       # Settle expired auctions
  "0 14 * * MON",    # Weekly standings post + auto-score + next lineup announcement
  "0 12 * * THU"     # Last-call reminder to non-bettors
]
```

**CRITICAL:** Cloudflare uses Quartz-style DOW where `1=Sunday`. Always use named days (`MON`, `THU`) to avoid off-by-one errors — see commit `0ba7ac7`.

---

## Admin Panel (WeekendPanel in `src/pages/Admin.jsx`)

| Section | What it does |
|---|---|
| Configure lineup | Pick a date + search catalog → save movie list for that weekend |
| Post announcement | Manually fire the `#game-feed` lineup embed post |
| Post last-call | Manually fire the Thursday reminder |
| Per-movie picks table | View all bets with inline edit (estimate) and delete |
| Abstentions | Shows which in-league players haven't bet on a given movie |
| Add pick | Admin can enter a bet on behalf of any player (by Discord user ID) |
| Score movie | Enter actual gross → calls scoring logic → posts to `#game-feed` |
| Users table | Shows `discord_user_id` column; Edit user prompts for Discord ID |

---

## Known Quirks and Edge Cases

- **Estimate storage inconsistency:** Estimates entered through the admin "Add pick" form before this was enforced may be stored as raw dollar amounts (e.g. `5000000`) instead of integer millions (`5`). The `fmtEstimate()` function in `Betting.jsx` handles both by treating values `>= 1,000,000` as raw dollars.

- **Betting window timing:** Uses `weekend_date > date('now')` (UTC). Movies open Friday in the US, which is often still Thursday UTC evening. If the weekend_date is set to the Friday release date, betting technically closes Thursday night UTC. This is intentional.

- **Auto-scoring dependency:** `autoScoreWeekendPicks` in `standings-job.js` depends on `backfillDailies` running first in the same job to populate BOM data. The order in `runStandingsPost` is: auto-score → backfill → standings. If BOM hasn't reported yet by 2pm UTC Monday, the auto-score will log "no BOM data yet — score manually" and skip that movie without crashing.

- **Abstentions in scoring:** `scoreMovie` counts a player as an abstention if they are `in_league = 1` AND have a `discord_user_id` AND did not place a pick. Website-only users (no real Discord ID) are not mentioned as abstentions in the Discord post.

- **Worker deploy required:** The worker does NOT auto-deploy with Pages. Any change to `worker/src/`, `worker/wrangler.toml`, or any helper imported by the worker (`_boxoffice.js`, `_discord.js`, `_weekend-scoring.js`, `_standings.js`, `_history.js`) requires a manual `cd worker && wrangler deploy`.
