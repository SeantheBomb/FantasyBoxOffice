// Batch-seeds guesser_pool from TMDB, ~10 candidates per invocation to
// stay under the 50-subrequest limit. Driven by a curl loop:
//   /trigger?job=seed-pool&year=1994&offset=0   (offsets 0,10,20,30)
// Initial 1970–2025 seeding done 2026-07. Re-run for a single year to
// refresh it (e.g. each January for the year that just ended).

import { tmdbFetch } from "../../functions/api/_tmdb.js";

export async function runSeedPoolChunk(env, year, offset) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS guesser_pool (
    tmdb_id INTEGER PRIMARY KEY, title TEXT NOT NULL, release_date TEXT NOT NULL,
    revenue INTEGER NOT NULL, runtime INTEGER DEFAULT 0, vote_average REAL DEFAULT 0,
    mpa_rating TEXT DEFAULT 'NR', genres TEXT DEFAULT '[]',
    production_companies TEXT DEFAULT '[]', top_cast TEXT DEFAULT '[]',
    poster_url TEXT, overview TEXT DEFAULT ''
  )`).run();

  const token = env.TMDB_TOKEN;
  const candidates = [];
  for (const page of [1, 2]) {
    const data = await tmdbFetch("/discover/movie", token, {
      region: "US",
      with_release_type: "2|3",
      primary_release_year: year,
      sort_by: "revenue.desc",
      include_adult: false,
      page,
    });
    candidates.push(...(data.results || []));
  }

  const chunk = candidates.slice(offset, offset + 10).filter((c) => c.id && c.title && c.poster_path);
  const rows = [];
  for (const c of chunk) {
    try {
      const [detail, credits, releaseDates] = await Promise.all([
        tmdbFetch(`/movie/${c.id}`, token),
        tmdbFetch(`/movie/${c.id}/credits`, token),
        tmdbFetch(`/movie/${c.id}/release_dates`, token),
      ]);
      if (!detail.revenue || detail.revenue < 100_000_000) continue;
      const us = releaseDates?.results?.find((r) => r.iso_3166_1 === "US");
      const mpa = us?.release_dates?.map((d) => d.certification).find((x) => x?.length > 0) || "NR";
      if (mpa === "NR") continue;
      rows.push({
        tmdb_id: detail.id,
        title: detail.title,
        release_date: detail.release_date,
        revenue: detail.revenue,
        runtime: detail.runtime || 0,
        vote_average: detail.vote_average || 0,
        mpa_rating: mpa,
        genres: JSON.stringify((detail.genres || []).map((g) => g.name)),
        production_companies: JSON.stringify((detail.production_companies || []).map((p) => p.name)),
        top_cast: JSON.stringify((credits.cast || []).slice(0, 10).map((p) => p.name)),
        poster_url: `https://image.tmdb.org/t/p/w342${detail.poster_path}`,
        overview: detail.overview || "",
      });
    } catch {
      // skip broken candidate
    }
  }

  if (rows.length) {
    const stmt = env.DB.prepare(
      `INSERT OR REPLACE INTO guesser_pool
       (tmdb_id,title,release_date,revenue,runtime,vote_average,mpa_rating,genres,production_companies,top_cast,poster_url,overview)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    await env.DB.batch(rows.map((r) => stmt.bind(
      r.tmdb_id, r.title, r.release_date, r.revenue, r.runtime, r.vote_average,
      r.mpa_rating, r.genres, r.production_companies, r.top_cast, r.poster_url, r.overview
    )));
  }

  return { year, offset, candidates: candidates.length, checked: chunk.length, kept: rows.length };
}
