export async function onRequest(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "2026-01-01";
  const to = url.searchParams.get("to") || "2026-12-31";
  const minPopularity = Number(url.searchParams.get("minPopularity") || "5");
  const strictDomestic = (url.searchParams.get("strictDomestic") || "0") === "1";

  // Cache key includes all query params that change results
  const cacheKeyUrl = new URL(url.origin + "/api/releases");
  cacheKeyUrl.searchParams.set("from", from);
  cacheKeyUrl.searchParams.set("to", to);
  cacheKeyUrl.searchParams.set("minPopularity", String(minPopularity));
  cacheKeyUrl.searchParams.set("strictDomestic", strictDomestic ? "1" : "0");

  const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });
  const cache = caches.default;

  const shouldRefresh = request.method === "POST";

  if (!shouldRefresh) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  if (!env.TMDB_TOKEN) {
    return json({ error: "Server misconfigured: TMDB_TOKEN missing" }, 500);
  }

  // Fetch + build list
  const results = await fetchReleases({
    token: env.TMDB_TOKEN,
    from,
    to,
    minPopularity,
    strictDomestic,
  });

  // Cache response (tune max-age as you like)
  const response = json(
    {
      from,
      to,
      minPopularity,
      strictDomestic,
      count: results.length,
      results,
      cachedAt: new Date().toISOString(),
    },
    200,
    {
      "Cache-Control": "public, max-age=86400", // 1 day
    }
  );

  // Store in cache
  await cache.put(cacheKey, response.clone());
  return response;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

async function tmdbFetch(path, token, params = {}) {
  const base = "https://api.themoviedb.org/3";
  const u = new URL(base + path);
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

function getUsTheatricalDateFromReleaseDates(releaseDatesJson) {
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

async function fetchReleases({ token, from, to, minPopularity, strictDomestic }) {
  // Step 1: Discover candidates (fast)
  let page = 1;
  let totalPages = 1;
  const all = [];

  while (page <= totalPages && page <= 500) {
    const data = await tmdbFetch("/discover/movie", token, {
      region: "US",
      with_release_type: 3, // Theatrical
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

  // Step 2: Domestic reinforcement
  // For “share-ready”, we do:
  // - strictDomestic: require US theatrical date in range
  // - non-strict: prefer US theatrical date when known, else keep primary date
  const candidates = all
    .filter((m) => (m.popularity ?? 0) >= minPopularity)
    .filter((m) => inRange(m.primary_release_date || m.release_date, from, to));

  // Only fetch release_dates for candidates; can be dozens-hundreds depending on filters.
  const out = [];
  for (const m of candidates) {
    let usDate = null;
    try {
      const rd = await tmdbFetch(`/movie/${m.id}/release_dates`, token);
      usDate = getUsTheatricalDateFromReleaseDates(rd);
    } catch {
      // ignore per-title errors, keep fallback behavior below
    }

    if (strictDomestic) {
      if (inRange(usDate, from, to)) out.push({ ...m, us_theatrical_date: usDate });
    } else {
      // keep if either US date in range OR primary date in range
      const primary = m.primary_release_date || m.release_date || null;
      if (inRange(usDate, from, to) || inRange(primary, from, to)) {
        out.push({ ...m, us_theatrical_date: usDate });
      }
    }
  }

  // Sort by domestic date when available, otherwise by primary
  out.sort((a, b) => {
    const ad = a.us_theatrical_date || a.primary_release_date || a.release_date || "9999-99-99";
    const bd = b.us_theatrical_date || b.primary_release_date || b.release_date || "9999-99-99";
    return ad.localeCompare(bd);
  });

  return out;
}
