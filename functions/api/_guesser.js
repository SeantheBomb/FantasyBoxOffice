import { tmdbFetch, posterUrl } from "./_tmdb.js";

const STOP_WORDS = new Set([
  'i','me','my','myself','we','our','ours','ourselves','you','your','yours',
  'yourself','yourselves','he','him','his','himself','she','her','hers',
  'herself','it','its','itself','they','them','their','theirs','themselves',
  'what','which','who','whom','this','that','these','those','am','is','are',
  'was','were','be','been','being','have','has','had','having','do','does',
  'did','doing','a','an','the','and','but','if','or','because','as','until',
  'while','of','at','by','for','with','about','against','between','into',
  'through','during','before','after','above','below','to','from','up','down',
  'in','out','on','off','over','under','again','further','then','once','here',
  'there','when','where','why','how','all','both','each','few','more','most',
  'other','some','such','no','nor','not','only','own','same','so','than',
  'too','very','just','will','would','could','should','may','might','shall',
  'can','must','need','now','also','even','still','well','back','any','s','t',
  'd','ll','m','re','ve','don','didn','doesn','isn','aren','wasn','weren',
  'won','wouldn','couldn','shouldn','hasn','haven','hadn','ain',
]);

function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ying') && w.length > 5) return w.slice(0, -4) + 'ie';
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ied') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ness') && w.length > 5) return w.slice(0, -4);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('er') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && w.length > 3) return w.slice(0, -1);
  if (w.endsWith('e') && w.length > 4) return w.slice(0, -1);
  return w;
}

export function tokenizeOverview(text) {
  const tokens = [];
  let blankIdx = 0;
  const regex = /([A-Za-z]+(?:'[A-Za-z]+)*)|([^A-Za-z]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      const word = match[1];
      const clean = word.toLowerCase().replace(/'/g, '');
      const isStop = STOP_WORDS.has(clean) || clean.length <= 2;
      if (isStop) {
        tokens.push({ text: word, blank: false });
      } else {
        tokens.push({ text: word, blank: true, i: blankIdx++, s: stem(clean) });
      }
    } else {
      tokens.push({ sp: match[2] });
    }
  }
  return tokens;
}

export function getRevealedTokens(answerOverview, guessOverview) {
  const tokens = tokenizeOverview(answerOverview || '');
  const blanks = tokens.filter(t => t.blank);
  const guessWords = (guessOverview || '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
  const guessStems = new Set(guessWords.filter(w => w.length > 2).map(stem));
  return blanks.filter(t => guessStems.has(t.s)).map(t => ({ i: t.i, text: t.text }));
}

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

// Picks the daily movie from the pre-seeded guesser_pool catalog:
// rows within ±3 days of today's month/day (any year). Pick a year
// bucket first so sparse decades get equal odds against
// blockbuster-dense recent years.
export async function getOrCreateDailyMovie(db, token, gameDate, salt = "") {
  const existing = await db
    .prepare("SELECT * FROM guesser_daily WHERE game_date = ?")
    .bind(gameDate)
    .first();
  if (existing) return existing;

  const center = new Date(`${gameDate}T00:00:00Z`);
  const days = [];
  for (let d = -3; d <= 3; d++) {
    days.push(new Date(center.getTime() + d * 86400000).toISOString().slice(5, 10));
  }
  const placeholders = days.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM guesser_pool WHERE substr(release_date, 6, 5) IN (${placeholders})`)
    .bind(...days)
    .all();
  if (!results?.length) return null;

  const byYear = new Map();
  for (const r of results) {
    const y = r.release_date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  }
  const years = [...byYear.keys()].sort();

  const rng = mulberry32(dateToSeed(gameDate + salt));
  const yearBucket = byYear.get(years[Math.floor(rng() * years.length)]);
  yearBucket.sort((a, b) => a.tmdb_id - b.tmdb_id);
  const pick = yearBucket[Math.floor(rng() * yearBucket.length)];

  const row = {
    game_date: gameDate,
    tmdb_id: pick.tmdb_id,
    title: pick.title,
    release_date: pick.release_date,
    revenue: pick.revenue,
    runtime: pick.runtime || 0,
    vote_average: pick.vote_average || 0,
    mpa_rating: pick.mpa_rating || "NR",
    genres: pick.genres,
    production_companies: pick.production_companies,
    top_cast: pick.top_cast,
    poster_url: pick.poster_url,
    overview: pick.overview || '',
  };

  await db
    .prepare(
      `INSERT INTO guesser_daily
       (game_date, tmdb_id, title, release_date, revenue, runtime, vote_average, mpa_rating, genres, production_companies, top_cast, poster_url, overview)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_date) DO NOTHING`
    )
    .bind(
      row.game_date, row.tmdb_id, row.title, row.release_date,
      row.revenue, row.runtime, row.vote_average, row.mpa_rating,
      row.genres, row.production_companies, row.top_cast, row.poster_url,
      row.overview
    )
    .run();

  return row;
}

function runtimeDirection(answerMin, guessMin) {
  if (answerMin == null || guessMin == null || answerMin === 0 || guessMin === 0) return null;
  const diff = answerMin - guessMin;
  if (Math.abs(diff) <= 5) return "close";
  return diff > 0 ? "longer" : "shorter";
}

function scoreDirection(answerScore, guessScore) {
  if (answerScore == null || guessScore == null || answerScore === 0 || guessScore === 0) return null;
  const diff = answerScore - guessScore;
  if (Math.abs(diff) <= 0.3) return "close";
  return diff > 0 ? "higher" : "lower";
}

function revenueDirection(answerRevenue, guessRevenue) {
  if (!answerRevenue || !guessRevenue) return null;
  const ratio = answerRevenue / guessRevenue;
  if (ratio >= 0.85 && ratio <= 1.15) return "close";
  return ratio > 1 ? "higher" : "lower";
}

async function fetchMpaRating(tmdbId, token) {
  try {
    const rd = await tmdbFetch(`/movie/${tmdbId}/release_dates`, token);
    const us = rd?.results?.find((r) => r.iso_3166_1 === "US");
    const cert = us?.release_dates?.map((d) => d.certification).find((c) => c?.length > 0);
    return cert || "NR";
  } catch {
    return "NR";
  }
}

// Guesses come from the pool (wall tiles), so the guess's metadata is
// one D1 read. TMDB fallback covers anything not in the pool.
export async function compareMovies(answer, guessedTmdbId, token, db) {
  let guess = null;
  if (db) {
    const poolRow = await db
      .prepare("SELECT * FROM guesser_pool WHERE tmdb_id = ?")
      .bind(guessedTmdbId)
      .first();
    if (poolRow) {
      guess = {
        title: poolRow.title,
        poster_url: poolRow.poster_url,
        release_year: poolRow.release_date?.slice(0, 4) || null,
        genres: JSON.parse(poolRow.genres),
        companies: JSON.parse(poolRow.production_companies),
        cast: JSON.parse(poolRow.top_cast),
        mpa: poolRow.mpa_rating || "NR",
        runtime: poolRow.runtime || 0,
        vote_average: poolRow.vote_average || 0,
        revenue: poolRow.revenue || 0,
        overview: poolRow.overview || '',
      };
    }
  }
  if (!guess) {
    const [detail, credits] = await Promise.all([
      tmdbFetch(`/movie/${guessedTmdbId}`, token),
      tmdbFetch(`/movie/${guessedTmdbId}/credits`, token),
    ]);
    guess = {
      title: detail.title,
      poster_url: posterUrl(detail.poster_path),
      release_year: detail.release_date?.slice(0, 4) || null,
      genres: (detail.genres || []).map((g) => g.name),
      companies: (detail.production_companies || []).map((c) => c.name),
      cast: (credits.cast || []).slice(0, 10).map((c) => c.name),
      mpa: await fetchMpaRating(guessedTmdbId, token),
      runtime: detail.runtime || 0,
      vote_average: detail.vote_average || 0,
      revenue: detail.revenue || 0,
      overview: detail.overview || '',
    };
  }

  const answerGenres = JSON.parse(answer.genres);
  const answerCompanies = JSON.parse(answer.production_companies);
  const answerCast = JSON.parse(answer.top_cast);

  const matchingGenres = answerGenres.filter((g) => guess.genres.includes(g));
  const matchingCompanies = answerCompanies.filter((c) => guess.companies.includes(c));
  const matchingCast = answerCast.filter((c) => guess.cast.includes(c));

  return {
    title: guess.title,
    poster_url: guess.poster_url,
    release_year: guess.release_year,
    genre_match: matchingGenres.length > 0,
    company_match: matchingCompanies.length > 0,
    cast_match: matchingCast.length > 0,
    matching_genres: matchingGenres,
    matching_companies: matchingCompanies,
    matching_cast: matchingCast,
    guessed_genres: guess.genres,
    guessed_companies: guess.companies,
    guessed_cast: guess.cast,
    mpa_rating: guess.mpa,
    mpa_match: guess.mpa === (answer.mpa_rating || "NR"),
    runtime: guess.runtime,
    runtime_direction: runtimeDirection(answer.runtime, guess.runtime),
    vote_average: guess.vote_average,
    score_direction: scoreDirection(answer.vote_average, guess.vote_average),
    revenue: guess.revenue,
    revenue_direction: revenueDirection(answer.revenue, guess.revenue),
    revealed: getRevealedTokens(answer.overview || '', guess.overview || ''),
  };
}
