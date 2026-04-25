import { json, badRequest, requireUser, notFound, forbidden } from "../../_auth";

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const tmdbId = Number(params.tmdbId);
  if (!Number.isInteger(tmdbId)) return notFound();

  const o = await env.DB.prepare(
    `SELECT tmdb_id, owner_user_id, purchase_price, is_void FROM owned_movies WHERE tmdb_id = ? LIMIT 1`
  ).bind(tmdbId).first();
  if (!o) return notFound("Not owned");
  if (o.owner_user_id !== user.id) return forbidden("You don't own this movie");
  if (o.is_void) return badRequest("Already void");

  const voidCost = 2 * o.purchase_price;
  if ((user.points_remaining || 0) < voidCost) {
    return badRequest(`Need ${voidCost} points to void this movie`);
  }

  await env.DB.batch([
    env.DB.prepare(`UPDATE owned_movies SET is_void = 1 WHERE tmdb_id = ?`).bind(tmdbId),
    env.DB.prepare(`UPDATE users SET points_remaining = points_remaining - ? WHERE id = ?`)
      .bind(voidCost, user.id),
  ]);

  return json({ ok: true, void_cost: voidCost });
}
