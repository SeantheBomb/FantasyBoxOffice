import React, { useMemo, useState } from "react";

/**
 * TMDB endpoints used:
 * - Discover movies by date window + US theatrical release type:
 *   GET https://api.themoviedb.org/3/discover/movie?region=US&with_release_type=3&release_date.gte=YYYY-MM-DD&release_date.lte=YYYY-MM-DD&sort_by=primary_release_date.asc&page=N
 *
 * - Movie details (budget) + credits + release_dates:
 *   GET https://api.themoviedb.org/3/movie/{id}?append_to_response=credits,release_dates
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";



function fmtMoney(n) {
  if (!n || n <= 0) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
  } catch {
    return `$${n}`;
  }
}

function fmtDate(d) {
  if (!d) return "—";
  // Keep it simple (YYYY-MM-DD -> MMM D, YYYY)
  const dt = new Date(d + "T00:00:00");
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function pickUsReleaseDate(movie, movieDetails) {
  // Prefer US theatrical date (type 3), else primary release date from discover result
  const rd = movieDetails?.release_dates?.results?.find((r) => r.iso_3166_1 === "US");
  const rels = rd?.release_dates ?? [];

  // TMDB release types: 1=Premiere, 2=Limited, 3=Theatrical, 4=Digital, 5=Physical, 6=TV
  const theatrical = rels
    .filter((x) => x.type === 3 && x.release_date)
    .sort((a, b) => new Date(a.release_date) - new Date(b.release_date))[0];

  return theatrical?.release_date?.slice(0, 10) || movie?.release_date || movie?.primary_release_date || null;
}

async function tmdbFetch(path, token, params = {}) {
  const url = new URL(TMDB_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json;charset=utf-8",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TMDB error ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

function MovieRow({ token, movie }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(null);
  const [err, setErr] = useState("");

  const posterUrl = movie.poster_path ? `${IMG_BASE}/w342${movie.poster_path}` : null;

  const loadDetails = async () => {
    setErr("");
    setLoading(true);
    try {
      const d = await tmdbFetch(`/movie/${movie.id}`, token, {
        append_to_response: "credits,release_dates",
      });
      setDetails(d);
    } catch (e) {
      setErr(e?.message || "Failed to load details");
    } finally {
      setLoading(false);
    }
  };

  const onToggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !details && !loading) {
      await loadDetails();
    }
  };

  const usDate =
    movie.us_theatrical_date ||
    (details ? pickUsReleaseDate(movie, details) : null) ||
    movie.release_date ||
    movie.primary_release_date;


  const castTop = useMemo(() => {
    const cast = details?.credits?.cast ?? [];
    return cast.slice(0, 10).map((c) => `${c.name}${c.character ? ` as ${c.character}` : ""}`);
  }, [details]);

  const crewKey = useMemo(() => {
    const crew = details?.credits?.crew ?? [];
    const wantJobs = new Set(["Director", "Writer", "Screenplay", "Producer", "Executive Producer", "Director of Photography"]);
    const filtered = crew.filter((p) => wantJobs.has(p.job));
    // De-dupe by job (keep first) but show multiple directors/writers if present
    const byJob = new Map();
    for (const p of filtered) {
      const key = `${p.job}:${p.name}`;
      if (!byJob.has(key)) byJob.set(key, p);
    }
    return Array.from(byJob.values()).slice(0, 12);
  }, [details]);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onToggle} style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}>
          {open ? "Hide" : "Show"}
        </button>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {movie.title} {movie.original_title && movie.original_title !== movie.title ? <span style={{ fontWeight: 400, opacity: 0.7 }}>({movie.original_title})</span> : null}
          </div>
          <div style={{ opacity: 0.8 }}>
            Release: <b>{fmtDate(usDate)}</b> · TMDB popularity: {Math.round(movie.popularity || 0)}
          </div>
        </div>

        {posterUrl ? (
          <img
            src={posterUrl}
            alt={`${movie.title} poster`}
            style={{ width: 64, height: 96, objectFit: "cover", borderRadius: 8, border: "1px solid #ccc" }}
          />
        ) : (
          <div style={{ width: 64, height: 96, borderRadius: 8, border: "1px solid #ccc", display: "grid", placeItems: "center", opacity: 0.6 }}>
            No poster
          </div>
        )}
      </div>

      {open ? (
        <div style={{ marginTop: 12 }}>
          {loading ? <div>Loading details…</div> : null}
          {err ? <div style={{ color: "crimson" }}>{err}</div> : null}

          {details ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Synopsis</div>
                <div style={{ opacity: 0.9 }}>{details.overview || "—"}</div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Budget</div>
                  <div>{fmtMoney(details.budget)}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>Runtime</div>
                  <div>{details.runtime ? `${details.runtime} min` : "—"}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>Genres</div>
                  <div>{(details.genres || []).map((g) => g.name).join(", ") || "—"}</div>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Top Cast</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {castTop.length ? castTop.map((x) => <li key={x}>{x}</li>) : <li>—</li>}
                </ul>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Key Crew</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {crewKey.length ? crewKey.map((p) => <li key={`${p.job}-${p.id}`}>{p.job}: {p.name}</li>) : <li>—</li>}
                </ul>
              </div>
            </div>
          ) : (
            !loading && <div style={{ opacity: 0.8 }}>No details loaded.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function getUsTheatricalDateFromReleaseDates(releaseDatesJson) {
  const us = releaseDatesJson?.results?.find((r) => r.iso_3166_1 === "US");
  const rels = us?.release_dates ?? [];
  const theatrical = rels
    .filter((x) => x.type === 3 && x.release_date)
    .sort((a, b) => new Date(a.release_date) - new Date(b.release_date))[0];

  return theatrical?.release_date?.slice(0, 10) || null;
}



export default function TmdbTheatricalReleasesPage() {
  const [token, setToken] = useState("");
  const [dateFrom, setDateFrom] = useState("2026-01-01");
  const [dateTo, setDateTo] = useState("2026-12-31");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [movies, setMovies] = useState([]);
  const [pagesFetched, setPagesFetched] = useState(0);
  const [minPopularity, setMinPopularity] = useState(5); // was 10
  const [strictDomestic, setStrictDomestic] = useState(false); // NEW


  const canSearch = token.trim().length > 20 && dateFrom && dateTo;

  const fetchAllPages = async () => {
    setError("");
    setMovies([]);
    setPagesFetched(0);
    setLoading(true);

    try {
      // Discover (paginated)
      let page = 1;
      let totalPages = 1;
      const all = [];

      while (page <= totalPages && page <= 500) {
        const data = await tmdbFetch("/discover/movie", token.trim(), {
          region: "US",
          with_release_type: 3, // Theatrical
          "primary_release_date.gte": dateFrom,
          "primary_release_date.lte": dateTo,
          "popularity.gte": minPopularity,
          sort_by: "primary_release_date.asc",
          page,
          include_adult: false,
          include_video: false,
        });


        totalPages = data.total_pages || 1;
        const results = data.results || [];

        all.push(...results);
        setPagesFetched(page);

        page += 1;
      }

      // Enforce "no limited run":
      // Remove anything that does NOT have a US theatrical release date OR has ONLY limited/digital.
      // We can’t fully validate “wide” without another data source, but we can exclude explicit "Limited".
      //
      // Strategy:
      // - Keep list as-is for speed, but when rendering details we’ll show the US theatrical date if it exists.
      // - Additionally, pre-filter obvious limited-only titles by doing a lightweight release_dates check
      //   for the first N (optional). To avoid hammering the API, we only do a cheap filter here:
      //   - Keep items that have release_date in discover results (most do)
      //
      // If you want strict filtering, flip STRICT_FILTER to true and it will check release types for every title (slower).
      const STRICT_FILTER = false;

      const inRange = (d) => d && d >= dateFrom && d <= dateTo;

      // First: apply popularity filter to candidates
      const candidates = all.filter((m) => (m.popularity ?? 0) >= minPopularity);

      // Second: fetch US theatrical dates (STRICT domestic enforcement)
      const withUsDates = [];
      for (const m of candidates) {
        const rd = await tmdbFetch(`/movie/${m.id}/release_dates`, token.trim());
        const usDate = getUsTheatricalDateFromReleaseDates(rd);
        if (inRange(usDate)) {
          withUsDates.push({ ...m, us_theatrical_date: usDate });
        }
      }

      // Sort by domestic theatrical date
      withUsDates.sort((a, b) => a.us_theatrical_date.localeCompare(b.us_theatrical_date));

      setMovies(withUsDates);


      if (STRICT_FILTER) {
        const checked = [];
        for (const m of all) {
          const d = await tmdbFetch(`/movie/${m.id}/release_dates`, token.trim());
          const us = d?.results?.find((r) => r.iso_3166_1 === "US");
          const rels = us?.release_dates ?? [];
          const hasTheatrical = rels.some((x) => x.type === 3);
          const hasLimited = rels.some((x) => x.type === 2);

          // Include theatrical, exclude limited-only (if it has theatrical we keep even if also had limited earlier)
          if (hasTheatrical && !(!hasTheatrical && hasLimited)) {
            checked.push(m);
          }
        }
        finalList = checked;
      }

      // Sort again just in case
      finalList.sort((a, b) => {
        const ad = (a.release_date || a.primary_release_date || "9999-99-99");
        const bd = (b.release_date || b.primary_release_date || "9999-99-99");
        return ad.localeCompare(bd);
      });

      setMovies(finalList);
    } catch (e) {
      setError(e?.message || "Failed to fetch releases");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>TMDB US Theatrical Releases</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14, marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>TMDB API Read Access Token (v4)</div>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token (starts with eyJ...)"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              type="password"
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>Date from</div>
            <input
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              type="date"
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>Date to</div>
            <input
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              type="date"
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>Min TMDB popularity</div>
            <input
              type="number"
              min="0"
              step="1"
              value={minPopularity}
              onChange={(e) => setMinPopularity(Number(e.target.value) || 0)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={strictDomestic}
              onChange={(e) => setStrictDomestic(e.target.checked)}
            />
            <span style={{ fontWeight: 600 }}>
              Require US theatrical release date (stricter, fewer results)
            </span>
          </label>

        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={fetchAllPages}
            disabled={!canSearch || loading}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #ccc",
              cursor: canSearch && !loading ? "pointer" : "not-allowed",
              fontWeight: 700,
            }}
          >
            {loading ? "Fetching…" : "Fetch releases"}
          </button>

          <div style={{ opacity: 0.8 }}>
            {loading ? `Pages fetched: ${pagesFetched}` : movies.length ? `Found: ${movies.length} titles` : " "}
          </div>
        </div>

        <div style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
          Filter: <b>US region</b> + <b>Theatrical (type 3)</b>. Excludes streaming/digital-only by design. “Wide” isn’t a perfect TMDB field;
          we exclude explicit <b>Limited (type 2)</b> if you enable strict filtering in code.
        </div>

        {error ? <div style={{ marginTop: 10, color: "crimson" }}>{error}</div> : null}
      </div>

      <div>
        {movies.map((m) => (
          <MovieRow key={m.id} token={token.trim()} movie={m} />
        ))}
        {!loading && !movies.length && !error ? (
          <div style={{ opacity: 0.7 }}>No results yet. Enter token + date range, then fetch.</div>
        ) : null}
      </div>
    </div>
  );
}
