import { json, badRequest, requireAdmin } from "../../_auth.js";

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const weekendDate = new URL(request.url).searchParams.get("weekend_date");
  let results;
  if (weekendDate) {
    ({ results } = await env.DB.prepare(
      `SELECT wm.tmdb_id, m.title, wm.weekend_date FROM weekend_movies wm
       JOIN movies m ON m.tmdb_id = wm.tmdb_id
       WHERE wm.weekend_date = ? ORDER BY m.title`
    )
      .bind(weekendDate)
      .all());
  } else {
    ({ results } = await env.DB.prepare(
      `SELECT wm.tmdb_id, m.title, wm.weekend_date FROM weekend_movies wm
       JOIN movies m ON m.tmdb_id = wm.tmdb_id
       WHERE wm.weekend_date >= date('now', '-3 days')
       ORDER BY wm.weekend_date, m.title`
    ).all());
  }

  return json({ movies: results });
}

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.weekend_date || !Array.isArray(body.tmdb_ids) || body.tmdb_ids.length === 0) {
    return badRequest("weekend_date and tmdb_ids[] required");
  }

  const { weekend_date, tmdb_ids } = body;

  await env.DB.prepare(`DELETE FROM weekend_movies WHERE weekend_date = ?`)
    .bind(weekend_date)
    .run();

  const stmts = tmdb_ids.map((id) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO weekend_movies (tmdb_id, weekend_date) VALUES (?, ?)`
    ).bind(id, weekend_date)
  );
  await env.DB.batch(stmts);

  return json({ ok: true, weekend_date, count: tmdb_ids.length });
}
