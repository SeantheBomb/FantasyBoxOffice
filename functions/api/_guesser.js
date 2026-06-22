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

// Pick today's movie. Strategy: search a handful of prior years for movies
// released in a ±3 day window around today's month/day. One discover call
// per year-window keeps us well under Cloudflare's subrequest limit.
export async function getOrCreateDailyMovie(db, token, gameDate, salt = "") {
  const existing = await db
    .prepare("SELECT * FROM guesser_daily WHERE game_date = ?")
    .bind(gameDate)
    .first();
  if (existing) return existing;

  const currentYear = parseInt(gameDate.slice(0, 4), 10);
  const mmdd = gameDate.slice(5); // "MM-DD"

  // Build candidate pool: spread across decades so any era can appear.
  // Each call covers a 7-day window (±3 days) to maximize hits.
  const candidates = [];
  const yearsToSearch = [
    currentYear - 1, currentYear - 3, currentYear - 5,
    currentYear - 8, currentYear - 12, currentYear - 18,
    currentYear - 25, currentYear - 35, currentYear - 45,
  ].filter((y) => y >= 1970);

  for (const y of yearsToSearch) {
    const center = new Date(`${y}-${mmdd}T00:00:00Z`);
    const from = new Date(center.getTime() - 3 * 86400000).toISOString().slice(0, 10);
    const to = new Date(center.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    try {
      const data = await tmdbFetch("/discover/movie", token, {
        region: "US",
        with_release_type: "2|3",
        "primary_release_date.gte": from,
        "primary_release_date.lte": to,
        sort_by: "popularity.desc",
        include_adult: false,
        page: 1,
      });
      for (const m of data.results || []) {
        if (m.id && m.title && (m.popularity || 0) >= 5) {
          candidates.push(m);
        }
      }
    } catch {
      // skip failed year
    }
    if (candidates.length >= 30) break;
  }

  if (!candidates.length) return null;

  // Deduplicate by tmdb_id, sort for stability, then shuffle deterministically
  const seen = new Set();
  const unique = candidates.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  unique.sort((a, b) => a.id - b.id);

  const rng = mulberry32(dateToSeed(gameDate + salt));
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }

  // Try candidates until we find one with revenue data.
  // Each attempt costs 2 subrequests (detail + credits).
  let picked = null;
  let detail = null;
  let credits = null;
  for (const c of unique.slice(0, 10)) {
    try {
      const [d, cr] = await Promise.all([
        tmdbFetch(`/movie/${c.id}`, token),
        tmdbFetch(`/movie/${c.id}/credits`, token),
      ]);
      if (d.revenue && d.revenue > 0) {
        picked = c;
        detail = d;
        credits = cr;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!picked || !detail) return null;

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

// Hangman-style letter reveals: any letter present in the guessed title
// reveals ALL of its positions in the answer title.
function compareLetters(answerTitle, guessTitle) {
  const aLower = answerTitle.toLowerCase();
  const guessLetters = new Set(guessTitle.toLowerCase().replace(/[^a-z]/g, "").split(""));
  const answerLetters = new Set(aLower.replace(/[^a-z]/g, "").split(""));

  const revealed = [];
  for (let i = 0; i < aLower.length; i++) {
    if (guessLetters.has(aLower[i])) {
      revealed.push({ index: i, char: answerTitle[i] });
    }
  }

  const eliminated = [...guessLetters].filter((l) => !answerLetters.has(l));
  return { revealed, eliminated };
}

// Compare a guessed movie against the answer — returns detailed hints
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

  const matchingGenres = answerGenres.filter((g) => guessGenres.includes(g));
  const matchingCompanies = answerCompanies.filter((c) => guessCompanies.includes(c));
  const matchingCast = answerCast.filter((c) => guessCast.includes(c));

  const letters = compareLetters(answer.title, detail.title);

  return {
    title: detail.title,
    poster_url: posterUrl(detail.poster_path),
    release_year: detail.release_date?.slice(0, 4) || null,
    genre_match: matchingGenres.length > 0,
    company_match: matchingCompanies.length > 0,
    cast_match: matchingCast.length > 0,
    matching_genres: matchingGenres,
    matching_companies: matchingCompanies,
    matching_cast: matchingCast,
    guessed_genres: guessGenres,
    guessed_companies: guessCompanies,
    guessed_cast: guessCast,
    revealed_positions: letters.revealed,
    eliminated_letters: letters.eliminated,
  };
}

export function formatRevenue(v) {
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + Math.round(v / 1e6) + "M";
  return "$" + v.toLocaleString();
}
