import { json, requireUser, notFound } from "../../_auth";

export async function onRequestGet({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const tmdbId = Number(params.tmdbId);
  if (!Number.isInteger(tmdbId)) return notFound();

  const movie = await env.DB.prepare(
    `SELECT tmdb_id, title, release_date, budget, poster_url, status, bom_slug
       FROM movies WHERE tmdb_id = ? LIMIT 1`
  ).bind(tmdbId).first();
  if (!movie) return notFound();

  const owned = await env.DB.prepare(
    `SELECT o.tmdb_id, o.owner_user_id, o.purchase_price, o.is_void, o.acquired_at,
            u.username AS owner_username
       FROM owned_movies o
       LEFT JOIN users u ON u.id = o.owner_user_id
       WHERE o.tmdb_id = ? LIMIT 1`
  ).bind(tmdbId).first();

  const dailies = await env.DB.prepare(
    `SELECT date, domestic_revenue, source FROM dailies
       WHERE tmdb_id = ? ORDER BY date ASC`
  ).bind(tmdbId).all();

  const activeAuction = await env.DB.prepare(
    `SELECT id, current_bid, current_bidder_id, ends_at FROM auctions
       WHERE tmdb_id = ? AND status = 'open' LIMIT 1`
  ).bind(tmdbId).first();

  return json({ movie, owned: owned || null, dailies: dailies.results || [], active_auction: activeAuction || null });
}
