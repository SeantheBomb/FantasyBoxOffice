import { json } from "../_auth.js";
import { getOrCreateDailyMovie } from "../_guesser.js";

export async function onRequestGet({ env }) {
  await bootstrapGuesserSchema(env.DB);

  const today = new Date().toISOString().slice(0, 10);
  const token = env.TMDB_TOKEN;

  const movie = await getOrCreateDailyMovie(env.DB, token, today);
  if (!movie) {
    return json({ error: "No movie found for today" }, { status: 404 });
  }

  // Aggregate completion stats
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) as total_players,
            ROUND(AVG(num_guesses), 1) as avg_guesses,
            MIN(num_guesses) as best_score
     FROM guesser_completions WHERE game_date = ?`
  ).bind(today).first();

  const distribution = await env.DB.prepare(
    `SELECT num_guesses, COUNT(*) as count
     FROM guesser_completions WHERE game_date = ?
     GROUP BY num_guesses ORDER BY num_guesses`
  ).bind(today).all();

  // How many unique players started (made at least one guess)
  const started = await env.DB.prepare(
    `SELECT COUNT(DISTINCT player_id) as total_started
     FROM guesser_guesses WHERE game_date = ?`
  ).bind(today).first();

  // Movies guessed today (unique players per movie)
  const guessedMovies = await env.DB.prepare(
    `SELECT guessed_title, guessed_tmdb_id, COUNT(DISTINCT player_id) as times_guessed
     FROM guesser_guesses WHERE game_date = ? AND guessed_title != ''
     GROUP BY guessed_tmdb_id ORDER BY times_guessed DESC`
  ).bind(today).all();

  return json({
    game_date: today,
    release_date: movie.release_date,
    revenue: movie.revenue,
    stats: {
      total_started: started?.total_started || 0,
      total_players: stats?.total_players || 0,
      avg_guesses: stats?.avg_guesses || 0,
      best_score: stats?.best_score || 0,
      distribution: (distribution?.results || []).map((r) => ({
        guesses: r.num_guesses,
        count: r.count,
      })),
      guessed_movies: (guessedMovies?.results || []).map((r) => ({
        title: r.guessed_title,
        tmdb_id: r.guessed_tmdb_id,
        times_guessed: r.times_guessed,
      })),
    },
  });
}

// Self-healing schema bootstrap
let guesserBootstrapped = false;
async function bootstrapGuesserSchema(db) {
  if (guesserBootstrapped) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS guesser_daily (
      game_date TEXT PRIMARY KEY, tmdb_id INTEGER NOT NULL, title TEXT NOT NULL,
      release_date TEXT NOT NULL, revenue INTEGER NOT NULL,
      genres TEXT DEFAULT '[]', production_companies TEXT DEFAULT '[]',
      top_cast TEXT DEFAULT '[]', poster_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS guesser_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, game_date TEXT NOT NULL,
      num_guesses INTEGER NOT NULL, player_id TEXT NOT NULL DEFAULT 'anonymous',
      completed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(game_date, player_id)
    )`,
    `CREATE TABLE IF NOT EXISTS guesser_guesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, game_date TEXT NOT NULL,
      guessed_tmdb_id INTEGER NOT NULL, guessed_title TEXT NOT NULL DEFAULT '',
      player_id TEXT NOT NULL DEFAULT 'anonymous',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(game_date, guessed_tmdb_id, player_id)
    )`,
  ];
  for (const sql of stmts) {
    try { await db.prepare(sql).run(); } catch { /* already exists */ }
  }
  // Self-healing column additions
  const alters = [
    `ALTER TABLE guesser_completions ADD COLUMN player_id TEXT NOT NULL DEFAULT 'anonymous'`,
    `ALTER TABLE guesser_daily ADD COLUMN runtime INTEGER DEFAULT 0`,
    `ALTER TABLE guesser_daily ADD COLUMN vote_average REAL DEFAULT 0`,
    `ALTER TABLE guesser_daily ADD COLUMN mpa_rating TEXT DEFAULT 'NR'`,
  ];
  for (const sql of alters) {
    try { await db.prepare(sql).run(); } catch { /* already exists */ }
  }
  try {
    await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_guesser_completions_player ON guesser_completions(game_date, player_id)`).run();
  } catch { /* already exists */ }
  guesserBootstrapped = true;
}
