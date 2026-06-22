import { json, badRequest } from "../_auth.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body?.num_guesses || !Number.isInteger(body.num_guesses) || body.num_guesses < 1) {
    return badRequest("num_guesses required (positive integer)");
  }

  const today = new Date().toISOString().slice(0, 10);

  await env.DB.prepare(
    `INSERT INTO guesser_completions (game_date, num_guesses) VALUES (?, ?)`
  ).bind(today, body.num_guesses).run();

  // Return updated stats
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
    ok: true,
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
