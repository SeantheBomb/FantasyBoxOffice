import { json, badRequest, requireAdmin } from "../../_auth.js";
import { scoreMovie } from "../../_weekend-scoring.js";

async function getActiveDate(db, override) {
  if (override) return override;
  const row = await db
    .prepare(
      `SELECT DISTINCT weekend_date FROM weekend_movies
       WHERE weekend_date >= date('now', '-3 days')
       ORDER BY weekend_date ASC LIMIT 1`
    )
    .first();
  return row?.weekend_date ?? null;
}

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const weekendDate = await getActiveDate(
    env.DB,
    new URL(request.url).searchParams.get("weekend_date")
  );
  if (!weekendDate) return json({ weekend_date: null, movies: [], picks: {}, abstentions: {} });

  const [{ results: movies }, { results: allPicks }, { results: leagueUsers }] = await Promise.all([
    env.DB.prepare(
      `SELECT m.tmdb_id, m.title, m.poster_url, u.username AS owner,
              wr.actual_gross, wr.scored_at
       FROM weekend_movies wm
       JOIN movies m ON m.tmdb_id = wm.tmdb_id
       JOIN owned_movies om ON om.tmdb_id = wm.tmdb_id AND om.is_void = 0
       JOIN users u ON u.id = om.owner_user_id
       LEFT JOIN weekend_results wr ON wr.tmdb_id = wm.tmdb_id AND wr.weekend_date = wm.weekend_date
       WHERE wm.weekend_date = ? ORDER BY m.title`
    )
      .bind(weekendDate)
      .all(),
    env.DB.prepare(
      `SELECT wp.discord_user_id, wp.discord_username, wp.tmdb_id, wp.estimate,
              wp.points_awarded, u.username AS fbo_username
       FROM weekend_picks wp
       LEFT JOIN users u ON u.discord_user_id = wp.discord_user_id
       WHERE wp.weekend_date = ?
       ORDER BY wp.tmdb_id, wp.estimate DESC`
    )
      .bind(weekendDate)
      .all(),
    env.DB.prepare(
      `SELECT id, username, discord_user_id FROM users
       WHERE in_league = 1 AND discord_user_id IS NOT NULL`
    ).all(),
  ]);

  const picksByMovie = {};
  for (const p of allPicks) {
    if (!picksByMovie[p.tmdb_id]) picksByMovie[p.tmdb_id] = [];
    picksByMovie[p.tmdb_id].push(p);
  }

  const abstentionsByMovie = {};
  for (const m of movies) {
    const pickers = new Set((picksByMovie[m.tmdb_id] || []).map((p) => p.discord_user_id));
    abstentionsByMovie[m.tmdb_id] = leagueUsers.filter((u) => !pickers.has(u.discord_user_id));
  }

  return json({ weekend_date: weekendDate, movies, picks: picksByMovie, abstentions: abstentionsByMovie });
}

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.weekend_date || !body?.tmdb_id || body.actual_gross == null) {
    return badRequest("weekend_date, tmdb_id, and actual_gross required");
  }

  const result = await scoreMovie(env.DB, body);

  if (env.DISCORD_GAME_FEED_WEBHOOK_URL) {
    await fetch(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: result.content }),
    }).catch(() => {});
  }

  return json({ ok: true, ...result });
}
