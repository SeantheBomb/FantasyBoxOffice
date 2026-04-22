// Auction settlement: when the ends_at timer has passed, transactionally:
//   - set auction status to 'sold'
//   - insert owned_movies for the winner
//   - decrement the winner's points_remaining
//
// Idempotent: safe to call on an already-settled auction (returns { settled: false }).

export async function settleAuction(db, auctionId) {
  const a = await db
    .prepare(
      `SELECT id, tmdb_id, status, current_bid, current_bidder_id, ends_at
         FROM auctions WHERE id = ? LIMIT 1`
    )
    .bind(auctionId)
    .first();

  if (!a) return { settled: false, reason: "not_found" };
  if (a.status !== "open") return { settled: false, reason: "not_open" };
  if (new Date(a.ends_at).getTime() > Date.now()) {
    return { settled: false, reason: "not_expired" };
  }

  const already = await db
    .prepare(`SELECT tmdb_id FROM owned_movies WHERE tmdb_id = ? LIMIT 1`)
    .bind(a.tmdb_id)
    .first();
  if (already) {
    // Edge case: movie got owned outside this auction. Cancel it.
    await db
      .prepare(`UPDATE auctions SET status = 'cancelled', settled_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), a.id)
      .run();
    return { settled: false, reason: "already_owned" };
  }

  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO owned_movies (tmdb_id, owner_user_id, purchase_price, is_void, acquired_at)
         VALUES (?, ?, ?, 0, ?)`
      )
      .bind(a.tmdb_id, a.current_bidder_id, a.current_bid, now),
    db
      .prepare(
        `UPDATE users SET points_remaining = points_remaining - ? WHERE id = ?`
      )
      .bind(a.current_bid, a.current_bidder_id),
    db
      .prepare(`UPDATE auctions SET status = 'sold', settled_at = ? WHERE id = ?`)
      .bind(now, a.id),
  ]);
  return { settled: true, tmdbId: a.tmdb_id, winnerId: a.current_bidder_id, price: a.current_bid };
}

// Settle every open auction whose timer has expired. Returns counts.
export async function settleExpiredAuctions(db) {
  const now = new Date().toISOString();
  const { results } = await db
    .prepare(`SELECT id FROM auctions WHERE status = 'open' AND ends_at <= ?`)
    .bind(now)
    .all();
  let settled = 0;
  let skipped = 0;
  for (const row of results || []) {
    const r = await settleAuction(db, row.id);
    if (r.settled) settled += 1;
    else skipped += 1;
  }
  return { settled, skipped, checked: results?.length || 0 };
}
