import { json } from "../_auth.js";

export async function onRequestGet({ env }) {
  const today = new Date().toISOString().slice(0, 10);

  // All past weekends, newest first
  const weekendsRows = await env.DB.prepare(
    `SELECT DISTINCT weekend_date FROM weekend_movies
     WHERE weekend_date < ? ORDER BY weekend_date DESC`
  ).bind(today).all();

  const weekendDates = (weekendsRows.results ?? []).map((r) => r.weekend_date);
  if (!weekendDates.length) return json({ weekends: [] });

  const weekends = [];
  for (const weekend_date of weekendDates) {
    const moviesRows = await env.DB.prepare(
      `SELECT m.tmdb_id, m.title, m.poster_url, m.release_date,
              u.username as owner, wr.actual_gross
       FROM weekend_movies wm
       JOIN movies m ON m.tmdb_id = wm.tmdb_id
       LEFT JOIN owned_movies om ON om.tmdb_id = m.tmdb_id AND om.is_void = 0
       LEFT JOIN users u ON u.id = om.owner_user_id
       LEFT JOIN weekend_results wr
         ON wr.tmdb_id = wm.tmdb_id AND wr.weekend_date = wm.weekend_date
       WHERE wm.weekend_date = ?`
    ).bind(weekend_date).all();

    const picksRows = await env.DB.prepare(
      `SELECT tmdb_id, discord_username, estimate, points_awarded
       FROM weekend_picks WHERE weekend_date = ?
       ORDER BY tmdb_id, COALESCE(points_awarded, -1) DESC, estimate DESC`
    ).bind(weekend_date).all();

    const picksByMovie = {};
    for (const p of picksRows.results ?? []) {
      if (!picksByMovie[p.tmdb_id]) picksByMovie[p.tmdb_id] = [];
      picksByMovie[p.tmdb_id].push(p);
    }

    const movies = (moviesRows.results ?? []).map((m) => ({
      ...m,
      picks: picksByMovie[m.tmdb_id] ?? [],
    }));

    weekends.push({ weekend_date, movies });
  }

  return json({ weekends });
}
