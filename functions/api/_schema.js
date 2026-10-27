// Self-healing schema bootstrap. Pages Functions and the worker call this
// before any query that depends on a recent schema change. The ALTER is
// idempotent: SQLite errors with "duplicate column" if the column already
// exists, which we swallow.
//
// The module-level flag ensures we only attempt the ALTER once per isolate.
// On cold start the ALTER runs again and errors harmlessly.

let bootstrapped = false;

export async function bootstrapSchema(db) {
  if (bootstrapped) return;
  await db.prepare(
    `ALTER TABLE users ADD COLUMN in_league INTEGER NOT NULL DEFAULT 1`
  ).run().catch(() => {}); // duplicate column = already applied
  await db.prepare(
    `ALTER TABLE movies ADD COLUMN budget_is_placeholder INTEGER NOT NULL DEFAULT 0`
  ).run().catch(() => {});
  await db.prepare(
    `ALTER TABLE users ADD COLUMN discord_user_id TEXT`
  ).run().catch(() => {});
  await db.prepare(
    `ALTER TABLE auctions ADD COLUMN warning_sent_at TEXT`
  ).run().catch(() => {});
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS weekend_betting_windows (
       weekend_date TEXT PRIMARY KEY,
       closes_at TEXT NOT NULL,
       updated_at TEXT DEFAULT (datetime('now'))
     )`
  ).run();
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS showdown_bets (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         weekend_date TEXT NOT NULL,
         tmdb_id INTEGER NOT NULL,
         stake INTEGER NOT NULL,
         outcome TEXT,
         payout INTEGER,
         settled_at TEXT,
         created_at TEXT DEFAULT (datetime('now')),
         UNIQUE(user_id, weekend_date)
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS showdown_results (
         weekend_date TEXT PRIMARY KEY,
         status TEXT NOT NULL,
         winner_tmdb_id INTEGER,
         grosses TEXT NOT NULL,
         settled_at TEXT DEFAULT (datetime('now'))
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS showdown_posts (
         weekend_date TEXT NOT NULL,
         kind TEXT NOT NULL,
         posted_at TEXT DEFAULT (datetime('now')),
         PRIMARY KEY (weekend_date, kind)
       )`
    ),
  ]);
  bootstrapped = true;
}
