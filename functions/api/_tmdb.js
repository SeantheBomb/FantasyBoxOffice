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

export async function discoverUsTheatrical({ token, from, to, minPopularity = 5 }) {
  let page = 1;
  let totalPages = 1;
  const all = [];
  while (page <= totalPages && page <= 500) {
    const data = await tmdbFetch("/discover/movie", token, {
      region: "US",
      with_release_type: 3,
      "primary_release_date.gte": from,
      "primary_release_date.lte": to,
      "popularity.gte": minPopularity,
      sort_by: "primary_release_date.asc",
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
export async function fetchReleases({ token, from, to, minPopularity = 5, strictDomestic = false }) {
  const all = await discoverUsTheatrical({ token, from, to, minPopularity });
  const candidates = all
    .filter((m) => (m.popularity ?? 0) >= minPopularity)
    .filter((m) => inRange(m.primary_release_date || m.release_date, from, to));

  const out = [];
  for (const m of candidates) {
    let usDate = null;
    try {
      const rd = await tmdbFetch(`/movie/${m.id}/release_dates`, token);
      usDate = getUsTheatricalDate(rd);
    } catch {
      // per-title failure — skip the US date, fall back to primary
    }
    if (strictDomestic) {
      if (inRange(usDate, from, to)) out.push({ ...m, us_theatrical_date: usDate });
    } else {
      const primary = m.primary_release_date || m.release_date || null;
      if (inRange(usDate, from, to) || inRange(primary, from, to)) {
        out.push({ ...m, us_theatrical_date: usDate });
      }
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

// Upsert a batch of movies into the D1 `movies` table. Each entry should have
// { tmdb_id, title, release_date, budget, poster_url }.
export async function upsertMovies(db, rows) {
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  const stmts = rows.map((r) =>
    db.prepare(
      `INSERT INTO movies (tmdb_id, title, release_date, budget, poster_url, status, tmdb_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, COALESCE((SELECT status FROM movies WHERE tmdb_id = ?), 'unreleased'), ?, ?)
       ON CONFLICT(tmdb_id) DO UPDATE SET
         title = excluded.title,
         release_date = excluded.release_date,
         budget = excluded.budget,
         poster_url = excluded.poster_url,
         tmdb_updated_at = excluded.tmdb_updated_at`
    ).bind(
      r.tmdb_id,
      r.title,
      r.release_date,
      r.budget || 0,
      r.poster_url || null,
      r.tmdb_id,
      now,
      now
    )
  );
  await db.batch(stmts);
  return rows.length;
}

// Full refresh flow: discover releases in a date range, fetch per-title detail
// (for budgets), upsert into D1. Returns count upserted.
export async function refreshMovies({ db, token, from, to, minPopularity = 5 }) {
  const releases = await fetchReleases({ token, from, to, minPopularity, strictDomestic: false });
  const rows = [];
  for (const m of releases) {
    let detail = null;
    try {
      detail = await getMovieDetail(m.id, token);
    } catch {
      // skip titles that fail detail lookup
      continue;
    }
    rows.push({
      tmdb_id: m.id,
      title: m.title || detail?.title || "",
      release_date: m.us_theatrical_date || m.primary_release_date || m.release_date,
      budget: detail?.budget || 0,
      poster_url: posterUrl(m.poster_path || detail?.poster_path),
    });
  }
  return upsertMovies(db, rows);
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
