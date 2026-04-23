// TMDB helpers shared by the Pages /api/releases endpoint, the admin refresh
// endpoints, and the cron worker.

const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

export async function tmdbFetch(path, token, params = {}) {
  const u = new URL(TMDB_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TMDB ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export function posterUrl(path) {
  return path ? POSTER_BASE + path : null;
}

export function getUsTheatricalDate(releaseDatesJson) {
  const us = releaseDatesJson?.results?.find((r) => r.iso_3166_1 === "US");
  const rels = us?.release_dates ?? [];
  const theatrical = rels
    .filter((x) => x.type === 3 && x.release_date)
    .sort((a, b) => new Date(a.release_date) - new Date(b.release_date))[0];
  return theatrical?.release_date?.slice(0, 10) || null;
}

function inRange(d, from, to) {
  return d && d >= from && d <= to;
}

export async function discoverUsTheatrical({ token, from, to, minPopularity = 0, maxPages = 15 }) {
  let page = 1;
  let totalPages = 1;
  const all = [];
  while (page <= totalPages && page <= maxPages) {
    const data = await tmdbFetch("/discover/movie", token, {
      region: "US",
      with_release_type: 3,
      "primary_release_date.gte": from,
      "primary_release_date.lte": to,
      "popularity.gte": minPopularity || undefined,
      sort_by: "popularity.desc",
      include_adult: false,
      include_video: false,
      page,
    });
    totalPages = data.total_pages || 1;
    all.push(...(data.results || []));
    page += 1;
  }
  return all;
}

// Returns movies filtered to those with a US theatrical date in range (strict),
// or a primary/US date in range (non-strict). Each result has us_theatrical_date.
// Non-strict mode skips per-movie release_dates calls to stay under Cloudflare's
// subrequest limit (50 on free, 1000 on paid) — the discover endpoint is already
// region-filtered to US + release_type=3 so primary_release_date is reliable.
export async function fetchReleases({ token, from, to, minPopularity = 0, strictDomestic = false }) {
  const all = await discoverUsTheatrical({ token, from, to, minPopularity });
  const candidates = all
    .filter((m) => (m.popularity ?? 0) >= minPopularity)
    .filter((m) => inRange(m.primary_release_date || m.release_date, from, to));

  const out = [];
  for (const m of candidates) {
    if (strictDomestic) {
      let usDate = null;
      try {
        const rd = await tmdbFetch(`/movie/${m.id}/release_dates`, token);
        usDate = getUsTheatricalDate(rd);
      } catch {
        // per-title failure — skip the US date, fall back to primary
      }
      if (inRange(usDate, from, to)) out.push({ ...m, us_theatrical_date: usDate });
    } else {
      out.push({ ...m, us_theatrical_date: null });
    }
  }

  out.sort((a, b) => {
    const ad = a.us_theatrical_date || a.primary_release_date || a.release_date || "9999-99-99";
    const bd = b.us_theatrical_date || b.primary_release_date || b.release_date || "9999-99-99";
    return ad.localeCompare(bd);
  });
  return out;
}

// Get full detail (needs budget) for a single TMDB id.
export async function getMovieDetail(id, token) {
  return tmdbFetch(`/movie/${id}`, token);
}

// Search TMDB by title (optionally constrained by year). Used by TSV import to
// resolve titles the main discover call didn't return — e.g., untitled sequels
// listed under working titles, or movies that haven't been flagged as US
// theatrical on TMDB yet.
export async function searchMovie(title, year, token) {
  const data = await tmdbFetch("/search/movie", token, {
    query: title,
    year: year || undefined,
    include_adult: false,
    language: "en-US",
  });
  return data?.results || [];
}

// Upsert a batch of movies into the D1 `movies` table. Budget is only
// written on INSERT (or when a real budget comes through backfillBudgets) —
// the UPDATE path leaves existing budget alone so the catalog refresh
// doesn't zero out values populated from TSV import or TMDB detail calls.
export async function upsertMovies(db, rows) {
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  const stmts = rows.map((r) =>
    db.prepare(
      `INSERT INTO movies (tmdb_id, title, release_date, budget, poster_url, popularity, status, tmdb_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT status FROM movies WHERE tmdb_id = ?), 'unreleased'), ?, ?)
       ON CONFLICT(tmdb_id) DO UPDATE SET
         title = excluded.title,
         release_date = excluded.release_date,
         poster_url = excluded.poster_url,
         popularity = excluded.popularity,
         tmdb_updated_at = excluded.tmdb_updated_at`
    ).bind(
      r.tmdb_id,
      r.title,
      r.release_date,
      r.budget || 0,
      r.poster_url || null,
      r.popularity || 0,
      r.tmdb_id,
      now,
      now
    )
  );
  await db.batch(stmts);
  return rows.length;
}

// Full refresh: discover every 2026 release (no popularity filter) and upsert
// metadata only. Skips per-movie detail calls — budgets are backfilled
// on-demand via backfillBudgets() for movies that actually need them (owned
// or auctioned). This keeps subrequests to ~15 (one per discover page).
export async function refreshMovies({ db, token, from, to, minPopularity = 0 }) {
  const releases = await fetchReleases({ token, from, to, minPopularity, strictDomestic: false });
  const rows = releases.map((m) => ({
    tmdb_id: m.id,
    title: m.title || "",
    release_date: m.us_theatrical_date || m.primary_release_date || m.release_date,
    budget: 0,
    poster_url: posterUrl(m.poster_path),
    popularity: m.popularity || 0,
  }));
  await upsertMovies(db, rows);
  return { upserted: rows.length, discovered: releases.length };
}

// Fetch TMDB detail (for budget) for up to `limit` movies that are either
// owned or have an open auction but have budget=0. Stays under subrequest
// limits by capping the batch size.
export async function backfillBudgets({ db, token, limit = 40 }) {
  const { results } = await db
    .prepare(
      `SELECT m.tmdb_id FROM movies m
         WHERE (m.budget IS NULL OR m.budget = 0)
           AND (
             EXISTS (SELECT 1 FROM owned_movies o WHERE o.tmdb_id = m.tmdb_id)
             OR EXISTS (SELECT 1 FROM auctions a WHERE a.tmdb_id = m.tmdb_id AND a.status = 'open')
           )
         LIMIT ?`
    )
    .bind(limit)
    .all();

  let updated = 0;
  for (const row of results || []) {
    try {
      const detail = await getMovieDetail(row.tmdb_id, token);
      if (detail?.budget) {
        await db
          .prepare(`UPDATE movies SET budget = ? WHERE tmdb_id = ?`)
          .bind(detail.budget, row.tmdb_id)
          .run();
        updated += 1;
      }
    } catch {
      continue;
    }
  }
  return { checked: results?.length || 0, updated };
}

// Roll movie status from unreleased → released (release_date <= today).
// Does not flip to 'complete' here; that comes from the dailies job.
export async function rollStatuses(db) {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .prepare(
      `UPDATE movies SET status = 'released'
         WHERE status = 'unreleased' AND release_date <= ?`
    )
    .bind(today)
    .run();
}
