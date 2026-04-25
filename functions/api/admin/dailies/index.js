import { json, badRequest, requireAdmin } from "../../_auth";

// Manual daily entry fallback (for when BOM scraping fails).
export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");

  const tmdbId = Number(body.tmdb_id);
  const date = body.date;
  const revenue = Number(body.domestic_revenue);
  if (!Number.isInteger(tmdbId)) return badRequest("tmdb_id required");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("date YYYY-MM-DD required");
  if (!Number.isFinite(revenue) || revenue < 0) return badRequest("domestic_revenue must be >= 0");

  const movie = await env.DB.prepare(`SELECT tmdb_id FROM movies WHERE tmdb_id = ?`)
    .bind(tmdbId).first();
  if (!movie) return badRequest("Movie not in database");

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO dailies (tmdb_id, date, domestic_revenue, source, scraped_at)
     VALUES (?, ?, ?, 'manual', ?)
     ON CONFLICT(tmdb_id, date) DO UPDATE SET
       domestic_revenue = excluded.domestic_revenue,
       source = 'manual',
       scraped_at = excluded.scraped_at`
  ).bind(tmdbId, date, Math.round(revenue), now).run();

  return json({ ok: true });
}
