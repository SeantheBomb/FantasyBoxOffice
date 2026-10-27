import { json, badRequest, requireUser } from "../_auth.js";
import {
  getOpenShowdown,
  getShowdownBoard,
  getAvailablePoints,
  parseStake,
  placeShowdownBet,
  insufficientMessage,
  postShowdownLockIn,
  mention,
} from "../_showdown.js";

export async function onRequestPost({ request, env, waitUntil }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const row = await env.DB.prepare(`SELECT in_league FROM users WHERE id = ?`).bind(user.id).first();
  if (!row?.in_league) return json({ error: "You must be in the league to join the showdown" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const tmdbId = Number(body?.tmdb_id);
  if (!Number.isInteger(tmdbId)) return badRequest("tmdb_id required");

  const sd = await getOpenShowdown(env.DB);
  if (!sd) return badRequest("Betting is closed for this showdown.");

  const { available, held } = await getAvailablePoints(env.DB, user.id);
  const stake = parseStake(body?.stake, available);
  if (!stake) return badRequest("Stake must be a whole number of at least 1 point.");
  if (stake > available) return badRequest(insufficientMessage(available, held).replace(/\*\*/g, ""));

  const result = await placeShowdownBet(env.DB, { userId: user.id, weekendDate: sd.weekend_date, tmdbId, stake });
  if (result.error) return badRequest(result.error.replace(/\*\*/g, ""));

  const board = await getShowdownBoard(env.DB, sd.weekend_date);
  const post = postShowdownLockIn(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
    board,
    who: mention(user),
    movie: result.movie,
    stake: result.stake,
    allIn: result.all_in,
    closesAt: sd.closes_at,
  });
  if (waitUntil) waitUntil(post);
  else await post;

  return json({ ok: true, stake: result.stake, all_in: result.all_in, balance: result.balance });
}
