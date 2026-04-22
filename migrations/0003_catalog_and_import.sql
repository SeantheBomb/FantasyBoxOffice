-- Catalog popularity for frontend filtering, and relax starting points now
-- that TSV import seeds players with custom starting_points.

ALTER TABLE movies ADD COLUMN popularity REAL NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_movies_popularity ON movies(popularity);
