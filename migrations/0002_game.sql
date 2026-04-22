-- Fantasy Box Office game schema (single-league v1).

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN points_remaining INTEGER NOT NULL DEFAULT 98;

CREATE TABLE IF NOT EXISTS movies (
  tmdb_id         INTEGER PRIMARY KEY,
  title           TEXT NOT NULL,
  release_date    TEXT NOT NULL,
  budget          INTEGER NOT NULL DEFAULT 0,
  poster_url      TEXT,
  status          TEXT NOT NULL DEFAULT 'unreleased',
  bom_slug        TEXT,
  tmdb_updated_at TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movies_status ON movies(status);
CREATE INDEX IF NOT EXISTS idx_movies_release_date ON movies(release_date);

CREATE TABLE IF NOT EXISTS owned_movies (
  tmdb_id         INTEGER PRIMARY KEY,
  owner_user_id   TEXT NOT NULL,
  purchase_price  INTEGER NOT NULL,
  is_void         INTEGER NOT NULL DEFAULT 0,
  acquired_at     TEXT NOT NULL,
  FOREIGN KEY (tmdb_id) REFERENCES movies(tmdb_id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_owned_user ON owned_movies(owner_user_id);

CREATE TABLE IF NOT EXISTS auctions (
  id                  TEXT PRIMARY KEY,
  tmdb_id             INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open',
  current_bid         INTEGER NOT NULL,
  current_bidder_id   TEXT NOT NULL,
  started_by_user_id  TEXT NOT NULL,
  ends_at             TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  settled_at          TEXT,
  FOREIGN KEY (tmdb_id) REFERENCES movies(tmdb_id),
  FOREIGN KEY (current_bidder_id) REFERENCES users(id),
  FOREIGN KEY (started_by_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_auctions_status_ends ON auctions(status, ends_at);
CREATE INDEX IF NOT EXISTS idx_auctions_tmdb ON auctions(tmdb_id);

CREATE TABLE IF NOT EXISTS auction_bids (
  id          TEXT PRIMARY KEY,
  auction_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  bid_at      TEXT NOT NULL,
  FOREIGN KEY (auction_id) REFERENCES auctions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_bids_auction ON auction_bids(auction_id, bid_at);

CREATE TABLE IF NOT EXISTS dailies (
  tmdb_id           INTEGER NOT NULL,
  date              TEXT NOT NULL,
  domestic_revenue  INTEGER NOT NULL,
  source            TEXT NOT NULL,
  scraped_at        TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, date),
  FOREIGN KEY (tmdb_id) REFERENCES movies(tmdb_id)
);
CREATE INDEX IF NOT EXISTS idx_dailies_date ON dailies(date);
