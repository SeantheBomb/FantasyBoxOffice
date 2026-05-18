import { json, badRequest, requireAdmin } from "../../_auth";

// Revoke ownership of a movie. Refunds the purchase price to the owner and
// deletes the owned_movies row. Used to correct mistakes from RecordAuction.
export async function onRequestDelete({ params, env, request }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const tmdbId = Number(params.id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return badRequest("Invalid tmdb_id");

  const row = await env.DB.prepare(
    `SELECT o.tmdb_id, o.owner_user_id, o.purchase_price, m.title
       FROM owned_movies o
       JOIN movies m ON m.tmdb_id = o.tmdb_id
       WHERE o.tmdb_id = ?`
  ).bind(tmdbId).first();
  if (!row) return badRequest("No ownership record found for that movie");

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET points_remaining = points_remaining + ? WHERE id = ?`
    ).bind(row.purchase_price, row.owner_user_id),
    env.DB.prepare(
      `DELETE FROM owned_movies WHERE tmdb_id = ?`
    ).bind(tmdbId),
  ]);

  return json({
    ok: true,
    movie: { tmdb_id: row.tmdb_id, title: row.title },
    refunded: row.purchase_price,
    owner_user_id: row.owner_user_id,
  });
}
