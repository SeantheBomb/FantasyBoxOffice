import { json, requireUser } from "../_auth";

// Current user's game state: points + owned movies with profit.
export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const [owned, latestDaily] = await Promise.all([
    env.DB.prepare(
      `SELECT o.tmdb_id, o.purchase_price, o.is_void, o.acquired_at,
              m.title, m.budget, m.poster_url, m.release_date, m.status
         FROM owned_movies o
         JOIN movies m ON m.tmdb_id = o.tmdb_id
         WHERE o.owner_user_id = ?
         ORDER BY m.release_date ASC`
    ).bind(user.id).all(),
    env.DB.prepare(
      `SELECT d.tmdb_id, d.domestic_revenue
         FROM dailies d
         JOIN (SELECT tmdb_id, MAX(date) AS max_date FROM dailies GROUP BY tmdb_id) last
           ON last.tmdb_id = d.tmdb_id AND last.max_date = d.date`
    ).all(),
  ]);

  const revenueByTmdb = new Map();
  for (const d of latestDaily.results || []) revenueByTmdb.set(d.tmdb_id, d.domestic_revenue);

  let totalProfit = 0;
  const movies = (owned.results || []).map((o) => {
    const revenue = revenueByTmdb.get(o.tmdb_id) || 0;
    const profit = o.is_void ? 0 : revenue - (o.budget || 0);
    totalProfit += profit;
    return {
      tmdb_id: o.tmdb_id,
      title: o.title,
      poster_url: o.poster_url,
      release_date: o.release_date,
      status: o.status,
      budget: o.budget,
      revenue,
      profit,
      purchase_price: o.purchase_price,
      is_void: !!o.is_void,
      acquired_at: o.acquired_at,
      void_cost: 2 * o.purchase_price,
    };
  });

  return json({
    points_remaining: user.points_remaining,
    total_profit: totalProfit,
    movies,
  });
}
