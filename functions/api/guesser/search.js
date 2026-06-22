import { json, badRequest } from "../_auth.js";
import { tmdbFetch, posterUrl } from "../_tmdb.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (!q || q.length < 2) return badRequest("q parameter required (min 2 chars)");

  const token = env.TMDB_TOKEN;
  const data = await tmdbFetch("/search/movie", token, {
    query: q,
    include_adult: false,
    language: "en-US",
  });

  const results = (data.results || [])
    .filter((m) => m.id && m.title)
    .slice(0, 15)
    .map((m) => ({
      tmdb_id: m.id,
      title: m.title,
      release_year: m.release_date?.slice(0, 4) || null,
      poster_url: posterUrl(m.poster_path),
    }));

  return json({ results });
}
