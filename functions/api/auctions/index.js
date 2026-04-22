import { json, badRequest, requireUser } from "../_auth";

const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || "open"; // open|all
  const clause = statusFilter === "all" ? "" : `WHERE a.status = 'open'`;

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.tmdb_id, a.status, a.current_bid, a.current_bidder_id,
            a.started_by_user_id, a.ends_at, a.created_at, a.settled_at,
            m.title, m.poster_url, m.release_date, m.budget,
            bidder.username AS current_bidder_username,
            starter.username AS started_by_username
       FROM auctions a
       JOIN movies m ON m.tmdb_id = a.tmdb_id
       LEFT JOIN users bidder ON bidder.id = a.current_bidder_id
       LEFT JOIN users starter ON starter.id = a.started_by_user_id
       ${clause}
       ORDER BY a.ends_at ASC`
  ).all();

  return json({ auctions: results || [] });
}

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");
  const tmdbId = Number(body.tmdbId);
  const startingBid = Number(body.startingBid ?? 1);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return badRequest("tmdbId required");
  if (!Number.isInteger(startingBid) || startingBid < 1) return badRequest("startingBid must be >= 1");

  const movie = await env.DB.prepare(
    `SELECT tmdb_id, title, status, release_date FROM movies WHERE tmdb_id = ?`
  ).bind(tmdbId).first();
  if (!movie) return badRequest("Movie not found");
  if (movie.status !== "unreleased") return badRequest("Movie already released");

  const existingOwner = await env.DB.prepare(
    `SELECT tmdb_id FROM owned_movies WHERE tmdb_id = ? AND is_void = 0`
  ).bind(tmdbId).first();
  if (existingOwner) return badRequest("Movie already owned");

  const existingAuction = await env.DB.prepare(
    `SELECT id FROM auctions WHERE tmdb_id = ? AND status = 'open'`
  ).bind(tmdbId).first();
  if (existingAuction) return badRequest("An auction is already open for this movie");

  if ((user.points_remaining || 0) < startingBid) {
    return badRequest("Not enough points for starting bid");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const endsAt = new Date(Date.now() + DEFAULT_DURATION_MS).toISOString();

  await env.DB.prepare(
    `INSERT INTO auctions
       (id, tmdb_id, status, current_bid, current_bidder_id, started_by_user_id, ends_at, created_at)
     VALUES (?, ?, 'open', ?, ?, ?, ?, ?)`
  ).bind(id, tmdbId, startingBid, user.id, user.id, endsAt, now).run();

  await env.DB.prepare(
    `INSERT INTO auction_bids (id, auction_id, user_id, amount, bid_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), id, user.id, startingBid, now).run();

  return json({ ok: true, id });
}
