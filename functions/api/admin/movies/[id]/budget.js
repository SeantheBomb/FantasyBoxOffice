import { json, badRequest, requireAdmin } from "../../../_auth";

// Set a placeholder budget for a movie that hasn't had an official figure
// published yet. Flagged with budget_is_placeholder=1 so automated TMDB
// refreshes will overwrite it once the real number appears.
export async function onRequestPost({ params, request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const tmdbId = Number(params.id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return badRequest("Invalid tmdb_id");

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");

  const budget = Number(body.budget);
  if (!Number.isFinite(budget) || budget < 0) return badRequest("budget must be >= 0");

  const movie = await env.DB.prepare(
    `SELECT tmdb_id, title FROM movies WHERE tmdb_id = ?`
  ).bind(tmdbId).first();
  if (!movie) return badRequest("Movie not in catalog");

  await env.DB.prepare(
    `UPDATE movies SET budget = ?, budget_is_placeholder = 1 WHERE tmdb_id = ?`
  ).bind(Math.round(budget), tmdbId).run();

  return json({ ok: true, movie: { tmdb_id: tmdbId, title: movie.title }, budget: Math.round(budget) });
}
