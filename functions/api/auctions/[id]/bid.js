import { json, badRequest, requireUser, notFound } from "../../_auth";

const EXTEND_MS = 5 * 60 * 1000;

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 1) return badRequest("amount must be an integer >= 1");

  const auction = await env.DB.prepare(
    `SELECT id, status, current_bid, current_bidder_id, ends_at FROM auctions WHERE id = ? LIMIT 1`
  ).bind(params.id).first();
  if (!auction) return notFound();
  if (auction.status !== "open") return badRequest("Auction is not open");
  if (new Date(auction.ends_at).getTime() <= Date.now()) {
    return badRequest("Auction has ended");
  }
  if (amount <= auction.current_bid) {
    return badRequest(`Bid must be greater than ${auction.current_bid}`);
  }
  if ((user.points_remaining || 0) < amount) {
    return badRequest("Not enough points");
  }

  const now = new Date().toISOString();
  const extended = new Date(Math.max(
    new Date(auction.ends_at).getTime(),
    Date.now() + EXTEND_MS
  )).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE auctions
         SET current_bid = ?, current_bidder_id = ?, ends_at = ?
         WHERE id = ? AND status = 'open'`
    ).bind(amount, user.id, extended, auction.id),
    env.DB.prepare(
      `INSERT INTO auction_bids (id, auction_id, user_id, amount, bid_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), auction.id, user.id, amount, now),
  ]);

  return json({ ok: true, current_bid: amount, ends_at: extended });
}
