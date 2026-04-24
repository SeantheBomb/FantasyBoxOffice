// Pure history/chart computation — shared by the Pages Function endpoint
// and the Discord worker (chart generation). Returns
//   { dates, series, movies, revenues, season }
// where series[i].points[j] is per-user cumulative profit at dates[j],
// movies is the list of owned in-season movies with owner/budget info,
// and revenues[tmdbId][j] is domestic revenue for that movie at dates[j]
// (null if not yet released at that date).

export async function computeHistory(db, { season = "2026" } = {}) {
  const seasonStart = `${season}-01-01`;
  const seasonEnd = `${season}-12-31`;

  const [users, movies, owned, dailies] = await Promise.all([
    db.prepare(`SELECT id, username FROM users WHERE in_league = 1 ORDER BY username`).all(),
    db.prepare(
      `SELECT tmdb_id, title, budget, release_date
         FROM movies
         WHERE release_date BETWEEN ? AND ?`
    ).bind(seasonStart, seasonEnd).all(),
    db.prepare(
      `SELECT tmdb_id, owner_user_id FROM owned_movies WHERE is_void = 0`
    ).all(),
    db.prepare(
      `SELECT tmdb_id, date, domestic_revenue
         FROM dailies
         WHERE date BETWEEN ? AND ?
         ORDER BY date ASC`
    ).bind(seasonStart, seasonEnd).all(),
  ]);

  const budgetByTmdb = new Map();
  const releaseByTmdb = new Map();
  const titleByTmdb = new Map();
  for (const m of movies.results || []) {
    budgetByTmdb.set(m.tmdb_id, m.budget || 0);
    releaseByTmdb.set(m.tmdb_id, m.release_date);
    titleByTmdb.set(m.tmdb_id, m.title);
  }
  const ownerByTmdb = new Map();
  for (const o of owned.results || []) ownerByTmdb.set(o.tmdb_id, o.owner_user_id);

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

  const sampleSet = new Set([seasonStart, seasonEnd]);
  for (const r of releaseByTmdb.values()) {
    if (r && r >= seasonStart && r <= seasonEnd) sampleSet.add(r);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (today >= seasonStart && today <= seasonEnd) sampleSet.add(today);
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
      if (!release || release > date) continue;
      const idx = userIdToSeriesIdx.get(ownerId);
      if (idx == null) continue;
      const revenue = revenueOnOrBefore(tmdbId, date);
      totals[idx] += revenue - (budgetByTmdb.get(tmdbId) || 0);
    }
    for (let i = 0; i < series.length; i++) series[i].points.push(totals[i]);
  }

  // Build per-movie metadata and revenue timeline for the client tooltip.
  const moviesList = [];
  const revenues = {};
  for (const [tmdbId, ownerId] of ownerByTmdb.entries()) {
    const release = releaseByTmdb.get(tmdbId);
    if (!release) continue; // not an in-season movie
    moviesList.push({
      tmdb_id: tmdbId,
      title: titleByTmdb.get(tmdbId) || "",
      owner_user_id: ownerId,
      release_date: release,
      budget: budgetByTmdb.get(tmdbId) || 0,
    });
    revenues[tmdbId] = dates.map((date) => {
      if (release > date) return null;
      return revenueOnOrBefore(tmdbId, date);
    });
  }

  return { dates, series, season, movies: moviesList, revenues };
}
