-- Movie Guesser daily minigame — fully separate from the main FBO game.
-- No foreign keys to existing tables; no login required.

CREATE TABLE IF NOT EXISTS guesser_daily (
  game_date TEXT PRIMARY KEY,
  tmdb_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  release_date TEXT NOT NULL,
  revenue INTEGER NOT NULL,
  genres TEXT DEFAULT '[]',
  production_companies TEXT DEFAULT '[]',
  top_cast TEXT DEFAULT '[]',
  poster_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guesser_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_date TEXT NOT NULL,
  num_guesses INTEGER NOT NULL,
  completed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guesser_completions_date ON guesser_completions(game_date);
