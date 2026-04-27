import { json, badRequest, requireAdmin } from "../../_auth";
import { tmdbFetch, posterUrl, getUsTheatricalDate, upsertMovies } from "../../_tmdb";

// Manually add a movie to the catalog by TMDB ID. Escape hatch for titles
// that don't surface in the discover query — limited theatrical, festival
// pickups, foreign-only releases, etc.
export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;
  if (!env.TMDB_TOKEN) return badRequest("TMDB_TOKEN missing");

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");
  const tmdbId = Number(body.tmdb_id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return badRequest("tmdb_id required");

  let detail;
  try {
    detail = await tmdbFetch(`/movie/${tmdbId}`, env.TMDB_TOKEN);
  } catch (e) {
    return json({ error: `TMDB lookup failed: ${e.message || e}` }, { status: 404 });
  }

  // Prefer US theatrical date; fall back to primary release_date.
  let releaseDate = detail.release_date || null;
  try {
    const rd = await tmdbFetch(`/movie/${tmdbId}/release_dates`, env.TMDB_TOKEN);
    const us = getUsTheatricalDate(rd);
    if (us) releaseDate = us;
  } catch {
    // ignore — keep the primary date
  }
  if (!releaseDate) return badRequest("Movie has no release date on TMDB");

  await upsertMovies(env.DB, [{
    tmdb_id: detail.id,
    title: detail.title || detail.original_title || "",
    release_date: releaseDate,
    budget: detail.budget || 0,
    poster_url: posterUrl(detail.poster_path),
    popularity: detail.popularity || 0,
  }]);

  // Roll status if it's already past release date.
  const today = new Date().toISOString().slice(0, 10);
  if (releaseDate <= today) {
    await env.DB.prepare(
      `UPDATE movies SET status = 'released'
         WHERE tmdb_id = ? AND status = 'unreleased'`
    ).bind(detail.id).run();
  }

  return json({
    ok: true,
    movie: {
      tmdb_id: detail.id,
      title: detail.title,
      release_date: releaseDate,
      budget: detail.budget || 0,
      popularity: detail.popularity || 0,
    },
  });
}
