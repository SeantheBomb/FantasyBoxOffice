import { json, badRequest, requireAdmin, notFound } from "../../../_auth";

export async function onRequestGet({ request, env, params }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const auction = await env.DB.prepare(
    `SELECT a.id, a.tmdb_id, a.status, a.current_bid, a.current_bidder_id,
            a.ends_at, a.created_at, a.settled_at,
            m.title,
            bidder.username AS current_bidder_username
       FROM auctions a
       JOIN movies m ON m.tmdb_id = a.tmdb_id
       LEFT JOIN users bidder ON bidder.id = a.current_bidder_id
       WHERE a.id = ? LIMIT 1`
  ).bind(params.id).first();
  if (!auction) return notFound();

  const bids = await env.DB.prepare(
    `SELECT b.id, b.amount, b.bid_at, u.id AS user_id, u.username
       FROM auction_bids b
       JOIN users u ON u.id = b.user_id
       WHERE b.auction_id = ?
       ORDER BY b.bid_at ASC`
  ).bind(params.id).all();

  const passes = await env.DB.prepare(
    `SELECT p.user_id, p.passed_at, u.username
       FROM auction_passes p
       JOIN users u ON u.id = p.user_id
       WHERE p.auction_id = ?
       ORDER BY p.passed_at ASC`
  ).bind(params.id).all();

  return json({
    auction,
    bids: bids.results || [],
    passes: passes.results || [],
  });
}

// Admin edit/cancel of an auction. Body fields (all optional):
//   status: "open" | "sold" | "cancelled"
//   current_bid: integer
//   current_bidder_id: user id
//   ends_at: ISO date
export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");

  const existing = await env.DB.prepare(`SELECT id FROM auctions WHERE id = ?`)
    .bind(params.id).first();
  if (!existing) return notFound();

  const fields = [];
  const values = [];
  if (body.status !== undefined) {
    if (!["open", "sold", "cancelled"].includes(body.status)) return badRequest("bad status");
    fields.push("status = ?"); values.push(body.status);
  }
  if (body.current_bid !== undefined) {
    const n = Number(body.current_bid);
    if (!Number.isInteger(n) || n < 1) return badRequest("bad current_bid");
    fields.push("current_bid = ?"); values.push(n);
  }
  if (body.current_bidder_id !== undefined) {
    fields.push("current_bidder_id = ?"); values.push(body.current_bidder_id);
  }
  if (body.ends_at !== undefined) {
    fields.push("ends_at = ?"); values.push(body.ends_at);
  }
  if (!fields.length) return badRequest("No editable fields supplied");

  await env.DB.prepare(
    `UPDATE auctions SET ${fields.join(", ")} WHERE id = ?`
  ).bind(...values, params.id).run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM auction_bids WHERE auction_id = ?`).bind(params.id),
    env.DB.prepare(`DELETE FROM auction_passes WHERE auction_id = ?`).bind(params.id),
    env.DB.prepare(`DELETE FROM auctions WHERE id = ?`).bind(params.id),
  ]);
  return json({ ok: true });
}
