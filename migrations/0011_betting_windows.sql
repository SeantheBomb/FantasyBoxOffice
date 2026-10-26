-- Admin override for when betting closes on a weekend. Absent row = default
-- close (midnight Eastern at the start of weekend_date).
CREATE TABLE IF NOT EXISTS weekend_betting_windows (
  weekend_date TEXT PRIMARY KEY,
  closes_at TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
