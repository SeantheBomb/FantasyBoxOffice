import { json, requireUser } from "../_auth";

// Time-series of each user's cumulative profit over time. One point per
// distinct daily date: for each user, sum (revenue_on_or_before_date - budget)
// across their owned, non-void movies.
export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const [users, movies, owned, dailies] = await Promise.all([
    env.DB.prepare(`SELECT id, username FROM users ORDER BY username`).all(),
    env.DB.prepare(`SELECT tmdb_id, budget FROM movies`).all(),
    env.DB.prepare(
      `SELECT tmdb_id, owner_user_id, is_void FROM owned_movies WHERE is_void = 0`
    ).all(),
    env.DB.prepare(
      `SELECT tmdb_id, date, domestic_revenue FROM dailies ORDER BY date ASC`
    ).all(),
  ]);

  const budgetByTmdb = new Map();
  for (const m of movies.results || []) budgetByTmdb.set(m.tmdb_id, m.budget || 0);

  const ownerByTmdb = new Map();
  for (const o of owned.results || []) ownerByTmdb.set(o.tmdb_id, o.owner_user_id);

  // latest revenue per (tmdb_id) up to and including each date, applied in order.
  const latestRevenueByTmdb = new Map();
  const dates = new Set();
  const pointsByDateUser = new Map(); // date -> Map(userId -> profit)

  const userIds = (users.results || []).map((u) => u.id);

  for (const row of dailies.results || []) {
    latestRevenueByTmdb.set(row.tmdb_id, row.domestic_revenue);
    dates.add(row.date);
    // Recompute totals for this date snapshot.
    const totals = new Map(userIds.map((id) => [id, 0]));
    for (const [tid, rev] of latestRevenueByTmdb.entries()) {
      const owner = ownerByTmdb.get(tid);
      if (!owner) continue;
      if (!totals.has(owner)) continue;
      const profit = rev - (budgetByTmdb.get(tid) || 0);
      totals.set(owner, totals.get(owner) + profit);
    }
    pointsByDateUser.set(row.date, totals);
  }

  const sortedDates = [...dates].sort();
  const series = (users.results || []).map((u) => ({
    userId: u.id,
    username: u.username,
    points: sortedDates.map((d) => pointsByDateUser.get(d)?.get(u.id) || 0),
  }));

  return json({ dates: sortedDates, series });
}
