import { json, requireAdmin } from "../../_auth.js";

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const params = new URL(request.url).searchParams;
  let weekendDate = params.get("weekend_date");

  if (!weekendDate) {
    // Compute the next Friday in UTC. If today is Friday, return next week's.
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun … 5=Fri … 6=Sat
    const daysUntilFriday = ((5 - day + 7) % 7) || 7;
    const friday = new Date(now);
    friday.setUTCDate(now.getUTCDate() + daysUntilFriday);
    weekendDate = friday.toISOString().slice(0, 10);
  }

  // Only suggest owned movies — unowned movies aren't in the admin catalog
  // and players only care about predicting movies someone actually drafted.
  const { results: movies } = await env.DB.prepare(
    `SELECT m.tmdb_id, m.title, m.release_date
     FROM movies m
     JOIN owned_movies om ON om.tmdb_id = m.tmdb_id AND om.is_void = 0
     WHERE m.release_date BETWEEN date(?, '-2 days') AND date(?, '+2 days')
       AND m.status != 'complete'
     ORDER BY m.title`
  )
    .bind(weekendDate, weekendDate)
    .all();

  return json({ weekend_date: weekendDate, movies });
}
