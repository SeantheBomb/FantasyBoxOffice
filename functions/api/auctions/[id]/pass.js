import { json, badRequest, requireUser, notFound } from "../../_auth";
import { settleIfAllPassed } from "../../_settlement";

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const auction = await env.DB.prepare(
    `SELECT id, status, current_bidder_id FROM auctions WHERE id = ? LIMIT 1`
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

  const settleResult = await settleIfAllPassed(env.DB, auction.id);
  return json({ ok: true, settled: settleResult.settled, settle_reason: settleResult.reason });
}
