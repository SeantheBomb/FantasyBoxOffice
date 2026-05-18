import { json, getCookie } from "../_auth.js";

export async function onRequestGet({ request, env }) {
  // Identify current user (unauthenticated access allowed — just no my_pick)
  const sessionId = getCookie(request, "session");
  let meDiscordId = null;
  let meInLeague = false;
  if (sessionId) {
    const s = await env.DB.prepare(
      `SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now') LIMIT 1`
    ).bind(sessionId).first();
    if (s) {
      const u = await env.DB.prepare(
        `SELECT id, discord_user_id, in_league FROM users WHERE id = ? LIMIT 1`
      ).bind(s.user_id).first();
      if (u) {
        meDiscordId = u.discord_user_id ?? "fbo_" + u.id;
        meInLeague = !!u.in_league;
      }
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  // Active = the earliest weekend that's within the last 7 days or in the future
  const weekend = await env.DB.prepare(
    `SELECT MIN(weekend_date) as weekend_date FROM weekend_movies
     WHERE weekend_date >= date('now', '-7 days')`
  ).first();

  if (!weekend?.weekend_date) return json({ weekend: null });

  const weekendDate = weekend.weekend_date;
  const isOpen = weekendDate > today;

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
  ).bind(weekendDate).all();

  const picksRows = await env.DB.prepare(
    `SELECT wp.tmdb_id, wp.discord_user_id,
            COALESCE(u.username, wp.discord_username) AS discord_username,
            wp.estimate, wp.points_awarded
     FROM weekend_picks wp
     LEFT JOIN users u ON u.discord_user_id = wp.discord_user_id
     WHERE wp.weekend_date = ?
     ORDER BY wp.tmdb_id, wp.estimate DESC`
  ).bind(weekendDate).all();

  const picksByMovie = {};
  for (const p of picksRows.results ?? []) {
    if (!picksByMovie[p.tmdb_id]) picksByMovie[p.tmdb_id] = [];
    picksByMovie[p.tmdb_id].push(p);
  }

  const movies = (moviesRows.results ?? []).map((m) => {
    const picks = picksByMovie[m.tmdb_id] ?? [];
    const myPick = meDiscordId ? (picks.find((p) => p.discord_user_id === meDiscordId) ?? null) : null;
    return { ...m, picks, my_pick: myPick };
  });

  return json({ weekend: { weekend_date: weekendDate, is_open: isOpen, is_in_league: meInLeague, movies } });
}
