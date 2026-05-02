import { json, badRequest, requireAdmin } from "../_auth";

// Manually record the result of an off-site auction (Discord, etc.).
// Inserts ownership, deducts points from the winner. Idempotent guard:
// refuses to assign a movie that's already owned (admin must remove the
// existing ownership row first if they need to overwrite).
export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");

  const tmdbId = Number(body.tmdb_id);
  const winnerId = String(body.winner_user_id || "");
  const price = Number(body.purchase_price);
  if (!Number.isInteger(tmdbId)) return badRequest("tmdb_id required");
  if (!winnerId) return badRequest("winner_user_id required");
  if (!Number.isFinite(price) || price < 0) return badRequest("purchase_price must be >= 0");
  const priceInt = Math.round(price);

  const movie = await env.DB.prepare(
    `SELECT tmdb_id, title FROM movies WHERE tmdb_id = ?`
  ).bind(tmdbId).first();
  if (!movie) return badRequest("Movie not in catalog");

  const winner = await env.DB.prepare(
    `SELECT id, username, points_remaining FROM users WHERE id = ?`
  ).bind(winnerId).first();
  if (!winner) return badRequest("Winner not found");

  const existing = await env.DB.prepare(
    `SELECT owner_user_id FROM owned_movies WHERE tmdb_id = ?`
  ).bind(tmdbId).first();
  if (existing) return badRequest("Movie is already owned — remove existing ownership first");

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO owned_movies (tmdb_id, owner_user_id, purchase_price, is_void, acquired_at)
       VALUES (?, ?, ?, 0, ?)`
    ).bind(tmdbId, winnerId, priceInt, now),
    env.DB.prepare(
      `UPDATE users SET points_remaining = points_remaining - ? WHERE id = ?`
    ).bind(priceInt, winnerId),
  ]);

  return json({
    ok: true,
    movie: { tmdb_id: tmdbId, title: movie.title },
    winner: { id: winner.id, username: winner.username },
    purchase_price: priceInt,
  });
}
