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

  // Aggregate stats
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

  return json({
    game_date: today,
    release_date: movie.release_date,
    revenue: movie.revenue,
    stats: {
      total_players: stats?.total_players || 0,
      avg_guesses: stats?.avg_guesses || 0,
      best_score: stats?.best_score || 0,
      distribution: (distribution?.results || []).map((r) => ({
        guesses: r.num_guesses,
        count: r.count,
      })),
    },
  });
}

// Self-healing schema bootstrap for the guesser tables
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
      num_guesses INTEGER NOT NULL, completed_at TEXT DEFAULT (datetime('now'))
    )`,
  ];
  for (const sql of stmts) {
    try { await db.prepare(sql).run(); } catch { /* already exists */ }
  }
  guesserBootstrapped = true;
}
