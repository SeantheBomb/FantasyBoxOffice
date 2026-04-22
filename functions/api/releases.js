import { fetchReleases } from "./_tmdb";

export async function onRequest(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "2026-01-01";
  const to = url.searchParams.get("to") || "2026-12-31";
  const minPopularity = Number(url.searchParams.get("minPopularity") || "5");
  const strictDomestic = (url.searchParams.get("strictDomestic") || "0") === "1";

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

  const results = await fetchReleases({
    token: env.TMDB_TOKEN,
    from,
    to,
    minPopularity,
    strictDomestic,
  });

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
    { "Cache-Control": "public, max-age=86400" }
  );

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
