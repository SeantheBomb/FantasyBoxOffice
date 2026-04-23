import { json, requireUser } from "../_auth";

// Profit over time across the full league calendar (all of 2026).
//
// Axis: every movie release_date in the season + weekly samples + today,
// deduped/sorted. For each sample date we compute, per user, the cumulative
// profit across their owned (non-void) movies that have actually been
// released by that date. Revenue is the latest daily we have on or before
// the sample date (so the line flatlines between scrape days and after the
// most recent scrape). Unreleased movies contribute 0 — the budget only
// kicks in once the movie is released, matching the standings.
export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const url = new URL(request.url);
  const season = url.searchParams.get("season") || "2026";
  const seasonStart = `${season}-01-01`;
  const seasonEnd = `${season}-12-31`;

  const [users, movies, owned, dailies] = await Promise.all([
    env.DB.prepare(`SELECT id, username FROM users ORDER BY username`).all(),
    env.DB.prepare(
      `SELECT tmdb_id, budget, release_date
         FROM movies
         WHERE release_date BETWEEN ? AND ?`
    ).bind(seasonStart, seasonEnd).all(),
    env.DB.prepare(
      `SELECT tmdb_id, owner_user_id FROM owned_movies WHERE is_void = 0`
    ).all(),
    env.DB.prepare(
      `SELECT tmdb_id, date, domestic_revenue
         FROM dailies
         WHERE date BETWEEN ? AND ?
         ORDER BY date ASC`
    ).bind(seasonStart, seasonEnd).all(),
  ]);

  const budgetByTmdb = new Map();
  const releaseByTmdb = new Map();
  for (const m of movies.results || []) {
    budgetByTmdb.set(m.tmdb_id, m.budget || 0);
    releaseByTmdb.set(m.tmdb_id, m.release_date);
  }
  const ownerByTmdb = new Map();
  for (const o of owned.results || []) ownerByTmdb.set(o.tmdb_id, o.owner_user_id);

  // Per-movie sorted list of {date, revenue} for stepped lookup.
  const dailiesByTmdb = new Map();
  for (const row of dailies.results || []) {
    if (!dailiesByTmdb.has(row.tmdb_id)) dailiesByTmdb.set(row.tmdb_id, []);
    dailiesByTmdb.get(row.tmdb_id).push({ date: row.date, revenue: row.domestic_revenue });
  }
  function revenueOnOrBefore(tmdbId, date) {
    const series = dailiesByTmdb.get(tmdbId);
    if (!series) return 0;
    let rev = 0;
    for (const d of series) {
      if (d.date > date) break;
      rev = d.revenue;
    }
    return rev;
  }

  // Sample points: season start, every Sunday, every release_date in season,
  // and today (if within the season).
  const sampleSet = new Set([seasonStart, seasonEnd]);
  for (const r of releaseByTmdb.values()) {
    if (r && r >= seasonStart && r <= seasonEnd) sampleSet.add(r);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (today >= seasonStart && today <= seasonEnd) sampleSet.add(today);
  // Weekly cadence: every Sunday between seasonStart and seasonEnd.
  {
    const d = new Date(seasonStart + "T00:00:00Z");
    while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
    while (true) {
      const iso = d.toISOString().slice(0, 10);
      if (iso > seasonEnd) break;
      sampleSet.add(iso);
      d.setUTCDate(d.getUTCDate() + 7);
    }
  }
  const dates = [...sampleSet].sort();

  const userRows = users.results || [];
  const series = userRows.map((u) => ({ userId: u.id, username: u.username, points: [] }));
  const userIdToSeriesIdx = new Map(userRows.map((u, i) => [u.id, i]));

  for (const date of dates) {
    const totals = new Array(userRows.length).fill(0);
    for (const [tmdbId, ownerId] of ownerByTmdb.entries()) {
      const release = releaseByTmdb.get(tmdbId);
      if (!release || release > date) continue; // not out yet → 0 contribution
      const idx = userIdToSeriesIdx.get(ownerId);
      if (idx == null) continue;
      const revenue = revenueOnOrBefore(tmdbId, date);
      totals[idx] += revenue - (budgetByTmdb.get(tmdbId) || 0);
    }
    for (let i = 0; i < series.length; i++) series[i].points.push(totals[i]);
  }

  return json({ dates, series, season });
}
