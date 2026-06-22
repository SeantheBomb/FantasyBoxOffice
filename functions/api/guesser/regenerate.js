import { json } from "../_auth.js";
import { getCookie } from "../_auth.js";
import { getOrCreateDailyMovie } from "../_guesser.js";

export async function onRequestPost({ request, env }) {
  // Admin-only
  const sessionId = getCookie(request, "session");
  if (!sessionId) return json({ error: "Not signed in" }, { status: 401 });

  const s = await env.DB.prepare(
    `SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now') LIMIT 1`
  ).bind(sessionId).first();
  if (!s) return json({ error: "Not signed in" }, { status: 401 });

  const user = await env.DB.prepare(
    `SELECT is_admin FROM users WHERE id = ? LIMIT 1`
  ).bind(s.user_id).first();
  if (!user?.is_admin) return json({ error: "Admin only" }, { status: 403 });

  const today = new Date().toISOString().slice(0, 10);
  const token = env.TMDB_TOKEN;

  // Delete current puzzle, completions, and guesses for today
  await env.DB.batch([
    env.DB.prepare("DELETE FROM guesser_daily WHERE game_date = ?").bind(today),
    env.DB.prepare("DELETE FROM guesser_completions WHERE game_date = ?").bind(today),
    env.DB.prepare("DELETE FROM guesser_guesses WHERE game_date = ?").bind(today),
  ]);

  // Regenerate with a random salt so the PRNG picks a different movie
  const salt = Math.random().toString(36).slice(2);
  const movie = await getOrCreateDailyMovie(env.DB, token, today, salt);
  if (!movie) {
    return json({ error: "Could not find a new movie" }, { status: 500 });
  }

  return json({
    ok: true,
    title: movie.title,
    release_date: movie.release_date,
    revenue: movie.revenue,
    title_length: movie.title.length,
  });
}
