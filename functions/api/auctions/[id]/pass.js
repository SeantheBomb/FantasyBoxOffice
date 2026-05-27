import { json, badRequest, requireUser, notFound } from "../../_auth";
import { settleIfAllPassed } from "../../_settlement";
import { postPassPlaced, postAuctionSettled } from "../../_discord";

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const auction = await env.DB.prepare(
    `SELECT a.id, a.status, a.current_bidder_id,
            m.title AS movie_title, m.poster_url, m.release_date
       FROM auctions a
       JOIN movies m ON m.tmdb_id = a.tmdb_id
       WHERE a.id = ? LIMIT 1`
  ).bind(params.id).first();
  if (!auction) return notFound();
  if (auction.status !== "open") return badRequest("Auction is not open");
  if (auction.current_bidder_id === user.id) {
    return badRequest("You're the current high bidder — place a different bid instead of passing");
  }

  await env.DB.prepare(
    `INSERT INTO auction_passes (auction_id, user_id, passed_at)
     VALUES (?, ?, ?)
     ON CONFLICT(auction_id, user_id) DO NOTHING`
  ).bind(auction.id, user.id, new Date().toISOString()).run();

  await postPassPlaced(env.DISCORD_WEBHOOK_URL, {
    movieTitle: auction.movie_title,
    passerDiscordId: user.discord_user_id,
    passerUsername: user.username,
  });

  const settleResult = await settleIfAllPassed(env.DB, auction.id);
  if (settleResult.settled) {
    await postAuctionSettled(env.DISCORD_WEBHOOK_URL, {
      movieTitle: settleResult.movieTitle,
      posterUrl: settleResult.posterUrl,
      releaseDate: settleResult.releaseDate,
      winnerDiscordId: settleResult.winnerDiscordId,
      winnerUsername: settleResult.winnerUsername,
      amount: settleResult.price,
    });
  }

  return json({ ok: true, settled: settleResult.settled, settle_reason: settleResult.reason });
}
