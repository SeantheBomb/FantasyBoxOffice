// Pure standings computation, shared by the Pages Function endpoint
// (functions/api/game/standings.js) and the Discord worker cron
// (worker/src/standings-job.js).
//
// Returns { users: [ { id, username, real_name, points_remaining,
// total_profit, movies: [...] } ] } ranked by total_profit desc. Movies
// per user are sorted by release_date ascending. Budget only counts against
// profit once the movie is released — unreleased picks stay at 0.

import { bootstrapSchema } from "../_schema.js";

export async function computeStandings(db) {
  await bootstrapSchema(db);
  const usersQ = db.prepare(
    `SELECT id, username, real_name, points_remaining FROM users WHERE in_league = 1 ORDER BY username`
  ).all();

  const latestDailyQ = db.prepare(
    `SELECT d.tmdb_id, d.domestic_revenue
       FROM dailies d
       JOIN (
         SELECT tmdb_id, MAX(date) AS max_date FROM dailies GROUP BY tmdb_id
       ) last ON last.tmdb_id = d.tmdb_id AND last.max_date = d.date`
  ).all();

  const moviesQ = db.prepare(
    `SELECT tmdb_id, title, budget, poster_url, release_date, status FROM movies`
  ).all();

  const ownedQ = db.prepare(
    `SELECT tmdb_id, owner_user_id, purchase_price, is_void FROM owned_movies`
  ).all();

  const [users, latestDaily, movies, owned] = await Promise.all([
    usersQ, latestDailyQ, moviesQ, ownedQ,
  ]);

  const revenueByTmdb = new Map();
  for (const d of latestDaily.results || []) {
    revenueByTmdb.set(d.tmdb_id, d.domestic_revenue);
  }
  const movieById = new Map();
  for (const m of movies.results || []) movieById.set(m.tmdb_id, m);

  const byUser = new Map();
  for (const u of users.results || []) {
    byUser.set(u.id, {
      id: u.id,
      username: u.username,
      real_name: u.real_name,
      points_remaining: u.points_remaining,
      total_profit: 0,
      movies: [],
    });
  }

  for (const o of owned.results || []) {
    const u = byUser.get(o.owner_user_id);
    if (!u) continue;
    const m = movieById.get(o.tmdb_id);
    if (!m) continue;
    const revenue = revenueByTmdb.get(o.tmdb_id) || 0;
    const released = m.status === "released" || m.status === "complete";
    const profit = o.is_void ? 0 : (released ? revenue - (m.budget || 0) : 0);
    u.total_profit += profit;
    u.movies.push({
      tmdb_id: m.tmdb_id,
      title: m.title,
      poster_url: m.poster_url,
      release_date: m.release_date,
      status: m.status,
      budget: m.budget,
      revenue,
      profit,
      purchase_price: o.purchase_price,
      is_void: !!o.is_void,
    });
  }

  for (const u of byUser.values()) {
    u.movies.sort((a, b) => (a.release_date || "").localeCompare(b.release_date || ""));
  }

  const ranked = [...byUser.values()].sort((a, b) => b.total_profit - a.total_profit);
  return { users: ranked };
}
