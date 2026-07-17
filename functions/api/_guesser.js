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

export async function getOrCreateDailyMovie(db, token, gameDate, salt = "") {
  const existing = await db
    .prepare("SELECT * FROM guesser_daily WHERE game_date = ?")
    .bind(gameDate)
    .first();
  if (existing) return existing;

  const currentYear = parseInt(gameDate.slice(0, 4), 10);
  const mmdd = gameDate.slice(5);

  const yearsToSearch = [
    currentYear - 1, currentYear - 3, currentYear - 5,
    currentYear - 8, currentYear - 12, currentYear - 18,
    currentYear - 25, currentYear - 35, currentYear - 45,
  ].filter((y) => y >= 1970);

  const rng = mulberry32(dateToSeed(gameDate + salt));

  // Collect up to 4 candidates per year, shuffle within each year
  const perYear = [];
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
        sort_by: "revenue.desc",
        include_adult: false,
        page: 1,
      });
      const yearCandidates = (data.results || []).filter((m) => m.id && m.title).slice(0, 4);
      for (let i = yearCandidates.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [yearCandidates[i], yearCandidates[j]] = [yearCandidates[j], yearCandidates[i]];
      }
      if (yearCandidates.length > 0) perYear.push(yearCandidates);
    } catch {
      // skip failed year
    }
  }

  if (!perYear.length) return null;

  // Shuffle the year buckets so no era is systematically first
  for (let i = perYear.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perYear[i], perYear[j]] = [perYear[j], perYear[i]];
  }

  // Try order: one rep per era first, then remaining candidates
  const tryOrder = [];
  const remainders = [];
  for (const bucket of perYear) {
    tryOrder.push(bucket[0]);
    for (let i = 1; i < bucket.length; i++) remainders.push(bucket[i]);
  }
  for (let i = remainders.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [remainders[i], remainders[j]] = [remainders[j], remainders[i]];
  }
  tryOrder.push(...remainders);

  const seen = new Set();
  // Cap at 10 candidates: 9 discovers + 10*2 + 1 credits = 30 subrequests max (free tier: 50)
  const toTry = tryOrder.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  }).slice(0, 10);

  let picked = null;
  let detail = null;
  let credits = null;
  let mpaRatingForPicked = "NR";
  for (const c of toTry) {
    try {
      // Fetch detail + release_dates together; defer credits until we have a winner
      const [d, rd] = await Promise.all([
        tmdbFetch(`/movie/${c.id}`, token),
        tmdbFetch(`/movie/${c.id}/release_dates`, token),
      ]);
      const us = rd?.results?.find((r) => r.iso_3166_1 === "US");
      const mpa = us?.release_dates?.map((r) => r.certification).find((c) => c?.length > 0) || "NR";
      if (d.revenue && d.revenue >= 100_000_000 && mpa !== "NR") {
        const cr = await tmdbFetch(`/movie/${c.id}/credits`, token);
        picked = c;
        detail = d;
        credits = cr;
        mpaRatingForPicked = mpa;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!picked || !detail) return null;

  const genres = (detail.genres || []).map((g) => g.name);
  const companies = (detail.production_companies || []).map((c) => c.name);
  const topCast = (credits.cast || []).slice(0, 10).map((c) => c.name);
  const mpaRating = mpaRatingForPicked;

  const row = {
    game_date: gameDate,
    tmdb_id: picked.id,
    title: detail.title || picked.title,
    release_date: detail.release_date || picked.release_date,
    revenue: detail.revenue || picked.revenue || 0,
    runtime: detail.runtime || 0,
    vote_average: detail.vote_average || 0,
    mpa_rating: mpaRating,
    genres: JSON.stringify(genres),
    production_companies: JSON.stringify(companies),
    top_cast: JSON.stringify(topCast),
    poster_url: posterUrl(detail.poster_path || picked.poster_path),
    overview: detail.overview || '',
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

  const guessMpa = await fetchMpaRating(guessedTmdbId, token);

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
    mpa_rating: guessMpa,
    mpa_match: guessMpa === (answer.mpa_rating || "NR"),
    runtime: detail.runtime || 0,
    runtime_direction: runtimeDirection(answer.runtime, detail.runtime),
    vote_average: detail.vote_average || 0,
    score_direction: scoreDirection(answer.vote_average, detail.vote_average),
    revealed: getRevealedTokens(answer.overview || '', detail.overview || ''),
  };
}
