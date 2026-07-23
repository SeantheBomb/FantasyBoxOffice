import { json } from "../_auth.js";

// The full tile-wall catalog. Excludes release_date/revenue/overview —
// those are clue-card data, not tile filtering criteria.
export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT tmdb_id, title, poster_url, genres, production_companies,
              top_cast, mpa_rating, runtime, vote_average
       FROM guesser_pool`
    ).all();
    return json(
      {
        movies: (results || []).map((r) => ({
          tmdb_id: r.tmdb_id,
          title: r.title,
          poster_url: r.poster_url,
          genres: JSON.parse(r.genres),
          companies: JSON.parse(r.production_companies),
          cast: JSON.parse(r.top_cast),
          mpa: r.mpa_rating,
          runtime: r.runtime,
          score: r.vote_average,
        })),
      },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  } catch (e) {
    return json({ error: "Pool unavailable", detail: e?.message }, { status: 500 });
  }
}
