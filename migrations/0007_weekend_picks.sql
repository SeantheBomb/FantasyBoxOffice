CREATE TABLE IF NOT EXISTS weekend_movies (
  tmdb_id     INTEGER NOT NULL,
  weekend_date TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, weekend_date),
  FOREIGN KEY (tmdb_id) REFERENCES movies(tmdb_id)
);

CREATE TABLE IF NOT EXISTS weekend_picks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id    TEXT NOT NULL,
  discord_username   TEXT NOT NULL,
  tmdb_id            INTEGER NOT NULL,
  estimate           INTEGER NOT NULL,
  weekend_date       TEXT NOT NULL,
  points_awarded     INTEGER,
  created_at         TEXT DEFAULT (datetime('now')),
  UNIQUE(discord_user_id, tmdb_id, weekend_date)
);

CREATE TABLE IF NOT EXISTS weekend_results (
  tmdb_id      INTEGER NOT NULL,
  weekend_date TEXT NOT NULL,
  actual_gross INTEGER NOT NULL,
  scored_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (tmdb_id, weekend_date)
);
