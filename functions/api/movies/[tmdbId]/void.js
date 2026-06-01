import { json, badRequest, requireUser, notFound, forbidden } from "../../_auth";
import { computeStandings } from "../../game/_standings.js";
import { postMovieVoided } from "../../_discord.js";

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const tmdbId = Number(params.tmdbId);
  if (!Number.isInteger(tmdbId)) return notFound();

  const o = await env.DB.prepare(
    `SELECT o.tmdb_id, o.owner_user_id, o.purchase_price, o.is_void,
            m.title, m.poster_url
     FROM owned_movies o
     JOIN movies m ON m.tmdb_id = o.tmdb_id
     WHERE o.tmdb_id = ? LIMIT 1`
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

  try {
    const standings = await computeStandings(env.DB);
    const ownerIndex = standings.users.findIndex((u) => u.id === user.id);
    const ownerStanding = ownerIndex >= 0 ? { ...standings.users[ownerIndex], place: ownerIndex + 1 } : null;
    await postMovieVoided(env.DISCORD_WEBHOOK_URL, {
      movieTitle: o.title,
      posterUrl: o.poster_url,
      ownerUsername: user.username,
      ownerDiscordId: user.discord_user_id ?? null,
      ownerStanding,
      voidCost,
    });
  } catch (e) {
    console.error("Discord void announcement failed:", e);
  }

  return json({ ok: true, void_cost: voidCost });
}
