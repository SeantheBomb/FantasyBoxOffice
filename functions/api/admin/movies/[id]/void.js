import { json, badRequest, notFound, requireAdmin } from "../../../_auth";
import { computeStandings } from "../../../game/_standings.js";
import { postMovieVoided } from "../../../_discord.js";

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const tmdbId = Number(params.id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return badRequest("Invalid tmdb_id");

  const row = await env.DB.prepare(
    `SELECT o.tmdb_id, o.owner_user_id, o.purchase_price, o.is_void,
            m.title, m.poster_url,
            u.username AS owner_username, u.discord_user_id AS owner_discord_id
     FROM owned_movies o
     JOIN movies m ON m.tmdb_id = o.tmdb_id
     JOIN users u ON u.id = o.owner_user_id
     WHERE o.tmdb_id = ? LIMIT 1`
  ).bind(tmdbId).first();

  if (!row) return notFound("Not owned");
  if (row.is_void) return badRequest("Already void");

  await env.DB.prepare(`UPDATE owned_movies SET is_void = 1 WHERE tmdb_id = ?`).bind(tmdbId).run();

  try {
    const standings = await computeStandings(env.DB);
    const ownerIndex = standings.users.findIndex((u) => u.id === row.owner_user_id);
    const ownerStanding = ownerIndex >= 0 ? { ...standings.users[ownerIndex], place: ownerIndex + 1 } : null;
    await postMovieVoided(env.DISCORD_WEBHOOK_URL, {
      movieTitle: row.title,
      posterUrl: row.poster_url,
      ownerUsername: row.owner_username,
      ownerDiscordId: row.owner_discord_id,
      ownerStanding,
    });
  } catch (e) {
    console.error("Discord void announcement failed:", e);
  }

  return json({ ok: true, movie: { title: row.title }, owner: { username: row.owner_username } });
}
