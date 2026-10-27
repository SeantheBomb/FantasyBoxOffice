-- Weekend showdown: pick which lineup movie grosses the most, stake points,
-- double or nothing. Stakes are deducted from users.points_remaining when the
-- bet is placed (escrow); settlement credits payout back.
CREATE TABLE IF NOT EXISTS showdown_bets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  weekend_date TEXT NOT NULL,
  tmdb_id      INTEGER NOT NULL,
  stake        INTEGER NOT NULL,
  outcome      TEXT,    -- won | lost | push | refunded
  payout       INTEGER, -- points credited at settlement (2x stake on a win)
  settled_at   TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, weekend_date)
);

CREATE TABLE IF NOT EXISTS showdown_results (
  weekend_date   TEXT PRIMARY KEY,
  status         TEXT NOT NULL, -- settled | push
  winner_tmdb_id INTEGER,
  grosses        TEXT NOT NULL, -- JSON { tmdb_id: dollars }
  settled_at     TEXT DEFAULT (datetime('now'))
);

-- One row per scheduled showdown post so a cron double-fire can't repeat it.
CREATE TABLE IF NOT EXISTS showdown_posts (
  weekend_date TEXT NOT NULL,
  kind         TEXT NOT NULL,
  posted_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (weekend_date, kind)
);
