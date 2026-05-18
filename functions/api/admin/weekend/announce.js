import { json, requireAdmin } from "../../_auth.js";
import { postWeekendAnnouncement } from "../../_discord.js";

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  if (!env.DISCORD_GAME_FEED_WEBHOOK_URL) {
    return json({ error: "DISCORD_GAME_FEED_WEBHOOK_URL not set" }, { status: 400 });
  }

  const { results: weekendMovies } = await env.DB.prepare(
    `SELECT m.tmdb_id, m.title, m.poster_url, u.username AS owner, wm.weekend_date
     FROM weekend_movies wm
     JOIN movies m ON m.tmdb_id = wm.tmdb_id
     JOIN owned_movies om ON om.tmdb_id = wm.tmdb_id AND om.is_void = 0
     JOIN users u ON u.id = om.owner_user_id
     WHERE wm.weekend_date >= date('now', '-1 days')
     ORDER BY m.title`
  ).all();

  if (!weekendMovies.length) {
    return json({ error: "No upcoming weekend movies configured" }, { status: 400 });
  }

  await postWeekendAnnouncement(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
    weekendDate: weekendMovies[0].weekend_date,
    movies: weekendMovies,
  });

  return json({ ok: true, movies: weekendMovies.map((m) => m.title) });
}
