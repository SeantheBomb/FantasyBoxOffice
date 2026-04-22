import { json, requireUser } from "../_auth";

// Returns every movie in the season with ownership + current profit.
export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status"); // unreleased|released|complete|all
  const ownerFilter = url.searchParams.get("owner"); // userId|none|any

  const [movies, owned, latestDaily, users] = await Promise.all([
    env.DB.prepare(
      `SELECT tmdb_id, title, release_date, budget, poster_url, status FROM movies ORDER BY release_date ASC`
    ).all(),
    env.DB.prepare(
      `SELECT tmdb_id, owner_user_id, purchase_price, is_void FROM owned_movies`
    ).all(),
    env.DB.prepare(
      `SELECT d.tmdb_id, d.domestic_revenue
         FROM dailies d
         JOIN (SELECT tmdb_id, MAX(date) AS max_date FROM dailies GROUP BY tmdb_id) last
           ON last.tmdb_id = d.tmdb_id AND last.max_date = d.date`
    ).all(),
    env.DB.prepare(`SELECT id, username FROM users`).all(),
  ]);

  const ownedByTmdb = new Map();
  for (const o of owned.results || []) ownedByTmdb.set(o.tmdb_id, o);
  const revenueByTmdb = new Map();
  for (const d of latestDaily.results || []) revenueByTmdb.set(d.tmdb_id, d.domestic_revenue);
  const usernameById = new Map();
  for (const u of users.results || []) usernameById.set(u.id, u.username);

  let rows = (movies.results || []).map((m) => {
    const o = ownedByTmdb.get(m.tmdb_id);
    const revenue = revenueByTmdb.get(m.tmdb_id) || 0;
    const profit = o && !o.is_void ? revenue - (m.budget || 0) : 0;
    return {
      tmdb_id: m.tmdb_id,
      title: m.title,
      release_date: m.release_date,
      budget: m.budget,
      poster_url: m.poster_url,
      status: m.status,
      owner_user_id: o?.owner_user_id || null,
      owner_username: o ? usernameById.get(o.owner_user_id) : null,
      purchase_price: o?.purchase_price ?? null,
      is_void: !!o?.is_void,
      revenue,
      profit,
    };
  });

  if (statusFilter && statusFilter !== "all") {
    rows = rows.filter((r) => r.status === statusFilter);
  }
  if (ownerFilter === "none") rows = rows.filter((r) => !r.owner_user_id);
  else if (ownerFilter === "any") rows = rows.filter((r) => r.owner_user_id);
  else if (ownerFilter && ownerFilter !== "all") {
    rows = rows.filter((r) => r.owner_user_id === ownerFilter);
  }

  return json({ movies: rows });
}
