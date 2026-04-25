import { json, requireUser, notFound } from "../../_auth";
import { eligibleBidderIds } from "../../_settlement";

export async function onRequestGet({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const id = params.id;
  const auction = await env.DB.prepare(
    `SELECT a.id, a.tmdb_id, a.status, a.current_bid, a.current_bidder_id,
            a.started_by_user_id, a.ends_at, a.created_at, a.settled_at,
            m.title, m.poster_url, m.release_date, m.budget,
            bidder.username AS current_bidder_username,
            starter.username AS started_by_username
       FROM auctions a
       JOIN movies m ON m.tmdb_id = a.tmdb_id
       LEFT JOIN users bidder ON bidder.id = a.current_bidder_id
       LEFT JOIN users starter ON starter.id = a.started_by_user_id
       WHERE a.id = ? LIMIT 1`
  ).bind(id).first();
  if (!auction) return notFound();

  const bids = await env.DB.prepare(
    `SELECT b.id, b.amount, b.bid_at, u.username
       FROM auction_bids b
       JOIN users u ON u.id = b.user_id
       WHERE b.auction_id = ?
       ORDER BY b.bid_at DESC`
  ).bind(id).all();

  const passes = await env.DB.prepare(
    `SELECT p.user_id, p.passed_at, u.username
       FROM auction_passes p
       JOIN users u ON u.id = p.user_id
       WHERE p.auction_id = ?
       ORDER BY p.passed_at ASC`
  ).bind(id).all();

  const eligible = await eligibleBidderIds(env.DB);
  const passedIds = new Set((passes.results || []).map((r) => r.user_id));
  const my_passed = passedIds.has(user.id);
  const eligible_count = eligible.length;
  const remaining = eligible.filter(
    (uid) => uid !== auction.current_bidder_id && !passedIds.has(uid)
  ).length;

  return json({
    auction,
    bids: bids.results || [],
    passes: passes.results || [],
    my_passed,
    eligible_count,
    remaining_bidders: remaining,
  });
}
