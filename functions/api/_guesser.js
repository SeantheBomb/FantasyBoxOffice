import { tmdbFetch, posterUrl } from "./_tmdb.js";

// Mulberry32 seeded PRNG — deterministic pick from date string
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateToSeed(dateStr) {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) {
    h = (Math.imul(31, h) + dateStr.charCodeAt(i)) | 0;
  }
  return h;
}

// Pick today's movie: discover movies released on this month/day in prior years.
// Cache the result in guesser_daily so all players see the same movie.
export async function getOrCreateDailyMovie(db, token, gameDate) {
  const existing = await db
    .prepare("SELECT * FROM guesser_daily WHERE game_date = ?")
    .bind(gameDate)
    .first();
  if (existing) return existing;

  const [month, day] = gameDate.slice(5).split("-");
  const currentYear = parseInt(gameDate.slice(0, 4), 10);

  // Search across several prior years for movies released on this month/day
  const candidates = [];
  const yearsToSearch = [];
  for (let y = currentYear - 1; y >= currentYear - 30 && y >= 1980; y--) {
    yearsToSearch.push(y);
  }

  // Batch discover calls — search 5 year ranges to stay under subrequest limits
  for (let i = 0; i < yearsToSearch.length; i += 5) {
    const batch = yearsToSearch.slice(i, i + 5);
    for (const y of batch) {
      const dateStr = `${y}-${month}-${day}`;
      try {
        const data = await tmdbFetch("/discover/movie", token, {
          "primary_release_date.gte": dateStr,
          "primary_release_date.lte": dateStr,
          sort_by: "revenue.desc",
          include_adult: false,
          "vote_count.gte": 50,
          page: 1,
        });
        for (const m of data.results || []) {
          if (m.id && m.title && (m.revenue || 0) > 0) {
            candidates.push(m);
          }
        }
      } catch {
        // skip failed year
      }
    }
    if (candidates.length >= 20) break;
  }

  if (!candidates.length) {
    return null;
  }

  // Sort by tmdb_id for stability, then pick deterministically
  candidates.sort((a, b) => a.id - b.id);
  const rng = mulberry32(dateToSeed(gameDate));
  const idx = Math.floor(rng() * candidates.length);
  const picked = candidates[idx];

  // Fetch full details: genres, production companies, credits
  const [detail, credits] = await Promise.all([
    tmdbFetch(`/movie/${picked.id}`, token),
    tmdbFetch(`/movie/${picked.id}/credits`, token),
  ]);

  const genres = (detail.genres || []).map((g) => g.name);
  const companies = (detail.production_companies || []).map((c) => c.name);
  const topCast = (credits.cast || [])
    .slice(0, 10)
    .map((c) => c.name);

  const row = {
    game_date: gameDate,
    tmdb_id: picked.id,
    title: detail.title || picked.title,
    release_date: detail.release_date || picked.release_date,
    revenue: detail.revenue || picked.revenue || 0,
    genres: JSON.stringify(genres),
    production_companies: JSON.stringify(companies),
    top_cast: JSON.stringify(topCast),
    poster_url: posterUrl(detail.poster_path || picked.poster_path),
  };

  await db
    .prepare(
      `INSERT INTO guesser_daily (game_date, tmdb_id, title, release_date, revenue, genres, production_companies, top_cast, poster_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_date) DO NOTHING`
    )
    .bind(
      row.game_date, row.tmdb_id, row.title, row.release_date,
      row.revenue, row.genres, row.production_companies, row.top_cast, row.poster_url
    )
    .run();

  return row;
}

// Compare a guessed movie against the answer — returns hint flags
export async function compareMovies(answer, guessedTmdbId, token) {
  const [detail, credits] = await Promise.all([
    tmdbFetch(`/movie/${guessedTmdbId}`, token),
    tmdbFetch(`/movie/${guessedTmdbId}/credits`, token),
  ]);

  const answerGenres = JSON.parse(answer.genres);
  const answerCompanies = JSON.parse(answer.production_companies);
  const answerCast = JSON.parse(answer.top_cast);

  const guessGenres = (detail.genres || []).map((g) => g.name);
  const guessCompanies = (detail.production_companies || []).map((c) => c.name);
  const guessCast = (credits.cast || []).slice(0, 10).map((c) => c.name);

  const genreMatch = answerGenres.some((g) => guessGenres.includes(g));
  const companyMatch = answerCompanies.some((c) => guessCompanies.includes(c));
  const castMatch = answerCast.some((c) => guessCast.includes(c));

  return {
    title: detail.title,
    poster_url: posterUrl(detail.poster_path),
    release_year: detail.release_date?.slice(0, 4) || null,
    genre_match: genreMatch,
    company_match: companyMatch,
    cast_match: castMatch,
    guessed_genres: guessGenres,
    guessed_companies: guessCompanies,
  };
}

export function formatRevenue(v) {
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + Math.round(v / 1e6) + "M";
  return "$" + v.toLocaleString();
}
