import { useState, useEffect, useRef, useMemo } from "react";
import { useUser } from "../useUser";
import { apiGuesserToday, apiGuesserPool, apiGuesserGuess, apiGuesserComplete, apiGuesserRegenerate } from "../api";
import "../MovieGuesser.css";

const STORAGE_KEY = "fbo_guesser_";
const PLAYER_ID_KEY = "fbo_guesser_player_id";
const PAGE_SIZE = 60;

function getPlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

function getStoredGame(date) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + date);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function storeGame(date, state) {
  localStorage.setItem(STORAGE_KEY + date, JSON.stringify(state));
}

function fmtRevenue(v) {
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + Math.round(v / 1e6) + "M";
  if (v >= 1e3) return "$" + Math.round(v / 1e3) + "K";
  return "$" + v;
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[Number(m) - 1]} ${Number(d)}, ${y}`;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strToSeed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// Accumulate hard constraints from wrong guesses. Only categorical
// facts (genre/studio/cast/rating) filter the wall — runtime and score
// arrows stay soft hints, and date/revenue/overview never filter.
function buildConstraints(guesses) {
  const c = {
    requiredGenres: new Set(), excludedGenres: new Set(),
    requiredCompanies: new Set(), excludedCompanies: new Set(),
    requiredCast: new Set(), excludedCast: new Set(),
    requiredMpa: null, excludedMpa: new Set(),
    guessedIds: new Set(),
  };
  for (const g of guesses) {
    if (g.correct) continue;
    c.guessedIds.add(g.tmdb_id);
    for (const genre of g.guessed_genres || []) {
      if ((g.matching_genres || []).includes(genre)) c.requiredGenres.add(genre);
      else c.excludedGenres.add(genre);
    }
    for (const co of g.guessed_companies || []) {
      if ((g.matching_companies || []).includes(co)) c.requiredCompanies.add(co);
      else c.excludedCompanies.add(co);
    }
    for (const actor of g.guessed_cast || []) {
      if ((g.matching_cast || []).includes(actor)) c.requiredCast.add(actor);
      else c.excludedCast.add(actor);
    }
    if (g.mpa_rating && g.mpa_rating !== "NR") {
      if (g.mpa_match) c.requiredMpa = g.mpa_rating;
      else c.excludedMpa.add(g.mpa_rating);
    }
  }
  return c;
}

function movieMatches(m, c) {
  if (c.guessedIds.has(m.tmdb_id)) return false;
  for (const g of c.requiredGenres) if (!m.genres.includes(g)) return false;
  for (const g of m.genres) if (c.excludedGenres.has(g)) return false;
  for (const co of c.requiredCompanies) if (!m.companies.includes(co)) return false;
  for (const co of m.companies) if (c.excludedCompanies.has(co)) return false;
  for (const a of c.requiredCast) if (!m.cast.includes(a)) return false;
  for (const a of m.cast) if (c.excludedCast.has(a)) return false;
  if (m.mpa && m.mpa !== "NR") {
    if (c.requiredMpa && m.mpa !== c.requiredMpa) return false;
    if (c.excludedMpa.has(m.mpa)) return false;
  } else if (c.requiredMpa) {
    return false;
  }
  return true;
}

function tileUrl(posterUrl) {
  return posterUrl ? posterUrl.replace("/w342", "/w185") : null;
}

function Countdown() {
  const [left, setLeft] = useState("");
  useEffect(() => {
    function calc() {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const diff = tomorrow - now;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLeft(`${h}h ${m}m ${s}s`);
    }
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{left}</span>;
}

function DirectionBadge({ label, value, direction }) {
  if (!value || value === "0" || value === "0.0" || value === "?") return null;
  const arrow = direction === "close" ? "≈" : direction === "higher" || direction === "longer" ? "▲" : "▼";
  const cls = direction === "close" ? "mg-badge--close" : "mg-badge--direction";
  return (
    <span className={`mg-badge ${cls}`}>
      {direction ? `${arrow} ` : ""}{label}: {value}
    </span>
  );
}

function HintBadge({ label, match }) {
  return (
    <span className={`mg-badge ${match ? "mg-badge--match" : "mg-badge--miss"}`}>
      {match ? "✓" : "✗"} {label}
    </span>
  );
}

function HintRow({ label, items, matchingSet }) {
  return (
    <div className="mg-hint-row">
      <span className="mg-hint-label">{label}</span>
      {items.length > 0 ? items.map((item) => (
        <HintBadge key={item} label={item} match={matchingSet.has(item)} />
      )) : (
        <span style={{ fontSize: 10, color: "var(--fbo-text-muted)" }}>Unknown</span>
      )}
    </div>
  );
}

function fmtRuntime(min) {
  if (!min) return "?";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function GuessHints({ guess }) {
  const matchingGenres = new Set(guess.matching_genres || []);
  const matchingCompanies = new Set(guess.matching_companies || []);
  const matchingCast = new Set(guess.matching_cast || []);
  return (
    <div className="mg-hints">
      <HintRow label="Genre" items={guess.guessed_genres || []} matchingSet={matchingGenres} />
      <HintRow label="Studio" items={guess.guessed_companies || []} matchingSet={matchingCompanies} />
      <HintRow label="Cast" items={guess.guessed_cast || []} matchingSet={matchingCast} />
      <div className="mg-hint-row">
        <span className="mg-hint-label">Rating</span>
        <HintBadge label={guess.mpa_rating || "NR"} match={guess.mpa_match} />
      </div>
      <div className="mg-hint-row">
        <span className="mg-hint-label">More</span>
        <DirectionBadge label="Runtime" value={fmtRuntime(guess.runtime)} direction={guess.runtime_direction} />
        <DirectionBadge label="Score" value={guess.vote_average?.toFixed(1)} direction={guess.score_direction} />
        <DirectionBadge label="Revenue" value={guess.revenue ? fmtRevenue(guess.revenue) : null} direction={guess.revenue_direction} />
      </div>
    </div>
  );
}

function StatsPanel({ stats }) {
  if (!stats || (!stats.total_players && !(stats.guessed_movies || []).length)) return null;
  const maxCount = Math.max(...(stats.distribution || []).map((d) => d.count), 1);
  const guessedMovies = stats.guessed_movies || [];
  return (
    <div className="mg-stats">
      <h3 className="mg-stats-title">Today's Stats</h3>
      {(stats.total_started > 0 || stats.total_players > 0) && (
        <>
          <div className="mg-stats-summary">
            {stats.total_started > 0 && <span>{stats.total_started} started</span>}
            <span>{stats.total_players} solved</span>
            {stats.total_players > 0 && <span>Avg: {stats.avg_guesses} guesses</span>}
            {stats.total_players > 0 && <span>Best: {stats.best_score}</span>}
          </div>
          {(stats.distribution || []).length > 0 && (
            <div className="mg-distribution">
              {stats.distribution.map((d) => (
                <div key={d.guesses} className="mg-dist-row">
                  <span className="mg-dist-label">{d.guesses}</span>
                  <div className="mg-dist-bar" style={{
                    width: `${Math.max((d.count / maxCount) * 100, 8)}%`,
                  }}>
                    {d.count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {guessedMovies.length > 0 && (
        <>
          <h4 className="mg-movies-header">Movies Guessed</h4>
          <div>
            {guessedMovies.map((m) => (
              <div key={m.tmdb_id} className="mg-movie-row">
                <span>{m.title}</span>
                <span>{m.times_guessed} player{m.times_guessed !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OverviewDisplay({ tokens, revealedMap, winRevealedMap, newlyRevealedIndices }) {
  if (!tokens || tokens.length === 0) return null;
  return (
    <p className="mg-overview">
      {tokens.map((t, idx) => {
        if (t.sp !== undefined) return <span key={idx}>{t.sp}</span>;
        if (t.text !== undefined) return <span key={idx}>{t.text}</span>;
        const earned = revealedMap[t.i];
        if (earned) {
          const isNew = newlyRevealedIndices?.has(t.i);
          return <span key={idx} className={`mg-revealed-word${isNew ? " mg-revealed-word--new" : ""}`}>{earned}</span>;
        }
        const winText = winRevealedMap?.[t.i];
        if (winText) {
          return <span key={idx} className="mg-win-revealed-word" style={{ "--word-idx": t.i }}>{winText}</span>;
        }
        return <span key={idx} className="mg-blank">_____</span>;
      })}
    </p>
  );
}

export default function MovieGuesser() {
  const { user } = useUser();
  const [puzzle, setPuzzle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [guesses, setGuesses] = useState([]);
  const [won, setWon] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [stats, setStats] = useState(null);
  const [overviewTokens, setOverviewTokens] = useState([]);
  const [revealedMap, setRevealedMap] = useState({});
  const [winRevealedMap, setWinRevealedMap] = useState({});
  const [newlyRevealedIndices, setNewlyRevealedIndices] = useState(new Set());
  const newlyRevealedTimer = useRef(null);
  const reportedRef = useRef(false);

  const [pool, setPool] = useState([]);
  const [poolError, setPoolError] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [dyingIds, setDyingIds] = useState(new Set());
  const dyingTimer = useRef(null);

  useEffect(() => {
    (async () => {
      const [todayRes, poolRes] = await Promise.all([apiGuesserToday(), apiGuesserPool()]);
      if (!todayRes.ok) {
        setError(todayRes.data?.error || "Failed to load puzzle");
        setLoading(false);
        return;
      }
      setPuzzle(todayRes.data);
      setStats(todayRes.data.stats);
      setOverviewTokens(todayRes.data.overview_tokens || []);
      if (poolRes.ok && poolRes.data.movies?.length) {
        setPool(poolRes.data.movies);
      } else {
        setPoolError(true);
      }

      const saved = getStoredGame(todayRes.data.game_date);
      if (saved) {
        setGuesses(saved.guesses || []);
        setWon(saved.won || false);
        setAnswer(saved.answer || null);
        reportedRef.current = saved.reported || false;
        const map = {};
        for (const g of saved.guesses || []) {
          for (const r of g.revealed || []) map[r.i] = r.text;
        }
        setRevealedMap(map);
        if (saved.winRevealed) {
          const wm = {};
          for (const r of saved.winRevealed) wm[r.i] = r.text;
          setWinRevealedMap(wm);
        }
      }
      setLoading(false);
    })();
  }, []);

  // Random wall order — seeded per player+day so pagination is stable across reloads
  const shuffledPool = useMemo(() => {
    if (!pool.length || !puzzle) return [];
    const rng = mulberry32(strToSeed(getPlayerId() + puzzle.game_date));
    const arr = [...pool];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [pool, puzzle]);

  const constraints = useMemo(() => buildConstraints(guesses), [guesses]);

  const visibleWall = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shuffledPool.filter((m) => {
      const alive = movieMatches(m, constraints) || dyingIds.has(m.tmdb_id);
      if (!alive) return false;
      if (q && !m.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [shuffledPool, constraints, dyingIds, query]);

  const remainingCount = useMemo(
    () => shuffledPool.filter((m) => movieMatches(m, constraints)).length,
    [shuffledPool, constraints]
  );

  const pageCount = Math.max(1, Math.ceil(visibleWall.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageTiles = visibleWall.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  async function submitGuess(movie) {
    if (won || submitting) return;
    if (guesses.some((g) => g.tmdb_id === movie.tmdb_id)) return;

    setSubmitting(true);
    setQuery("");
    setPage(0);

    const playerId = getPlayerId();
    const res = await apiGuesserGuess(movie.tmdb_id, movie.title, playerId);
    if (!res.ok) {
      setSubmitting(false);
      return;
    }

    const newRevealed = res.data.revealed || [];
    const updatedRevealedMap = { ...revealedMap };
    for (const r of newRevealed) updatedRevealedMap[r.i] = r.text;

    const guess = {
      tmdb_id: movie.tmdb_id,
      title: movie.title,
      poster_url: movie.poster_url,
      correct: res.data.correct,
      genre_match: res.data.genre_match,
      company_match: res.data.company_match,
      cast_match: res.data.cast_match,
      matching_genres: res.data.matching_genres || [],
      matching_companies: res.data.matching_companies || [],
      matching_cast: res.data.matching_cast || [],
      guessed_genres: res.data.guessed_genres || [],
      guessed_companies: res.data.guessed_companies || [],
      guessed_cast: res.data.guessed_cast || [],
      mpa_rating: res.data.mpa_rating || "NR",
      mpa_match: res.data.mpa_match || false,
      runtime: res.data.runtime || 0,
      runtime_direction: res.data.runtime_direction,
      vote_average: res.data.vote_average || 0,
      score_direction: res.data.score_direction,
      revenue: res.data.revenue || 0,
      revenue_direction: res.data.revenue_direction,
      revealed: newRevealed,
    };

    if (newRevealed.length) {
      setRevealedMap(updatedRevealedMap);
      setNewlyRevealedIndices(new Set(newRevealed.map(r => r.i)));
      clearTimeout(newlyRevealedTimer.current);
      newlyRevealedTimer.current = setTimeout(() => setNewlyRevealedIndices(new Set()), 1200);
    }

    const newGuesses = [...guesses, guess];

    if (!res.data.correct) {
      // Knock-away juice: tiles alive under old constraints but dead under new
      const oldC = constraints;
      const newC = buildConstraints(newGuesses);
      const dying = new Set(
        shuffledPool
          .filter((m) => movieMatches(m, oldC) && !movieMatches(m, newC))
          .map((m) => m.tmdb_id)
      );
      if (dying.size) {
        setDyingIds(dying);
        clearTimeout(dyingTimer.current);
        dyingTimer.current = setTimeout(() => setDyingIds(new Set()), 700);
      }
    }

    setGuesses(newGuesses);

    if (res.data.correct) {
      setWon(true);
      const answerData = {
        title: res.data.title,
        poster_url: res.data.poster_url,
        release_date: res.data.release_date,
        revenue: res.data.revenue,
        genres: res.data.genres,
        production_companies: res.data.production_companies || [],
        top_cast: res.data.top_cast || [],
      };
      setAnswer(answerData);

      const allBlanks = res.data.all_blanks || [];
      const winFilled = allBlanks.filter(r => !(r.i in updatedRevealedMap));
      const wm = {};
      for (const r of winFilled) wm[r.i] = r.text;
      setWinRevealedMap(wm);

      if (!reportedRef.current) {
        const completeRes = await apiGuesserComplete(newGuesses.length, playerId);
        if (completeRes.ok) setStats(completeRes.data.stats);
        reportedRef.current = true;
      }
      storeGame(puzzle.game_date, { guesses: newGuesses, won: true, answer: answerData, reported: true, winRevealed: winFilled });
    } else {
      storeGame(puzzle.game_date, { guesses: newGuesses, won: false });
    }
    setSubmitting(false);
  }

  async function handleShare() {
    const tempLine = guesses.map((g) => {
      if (g.correct) return "⭐";
      let heat = 0;
      if (g.genre_match) heat++;
      if (g.company_match) heat++;
      if (g.cast_match) heat++;
      if (g.mpa_match) heat++;
      if (g.runtime_direction === "close") heat++;
      if (g.score_direction === "close") heat++;
      return heat >= 2 ? "🟧" : "🟦";
    }).join(" ");

    const [y] = puzzle.release_date.split("-");
    const text = `🎬 Movie Guesser — ${fmtDate(puzzle.release_date).replace(/, \d+$/, `, ${y}`)}\n${tempLine}\n\n📅 ${y} · 💰 ${fmtRevenue(puzzle.revenue)}\n\nfantasyboxoffice.pages.dev/guesser`;
    try {
      await navigator.clipboard.writeText(text);
    } catch { /* fallback */ }
  }

  function resetLocalState() {
    if (puzzle) localStorage.removeItem(STORAGE_KEY + puzzle.game_date);
    setGuesses([]);
    setWon(false);
    setAnswer(null);
    setStats(null);
    setRevealedMap({});
    setWinRevealedMap({});
    setNewlyRevealedIndices(new Set());
    setDyingIds(new Set());
    setPage(0);
    setQuery("");
    reportedRef.current = false;
  }

  if (loading) {
    return (
      <div className="mg-page" style={{ textAlign: "center", paddingTop: 60 }}>
        <p style={{ color: "var(--fbo-text-muted)" }}>Loading puzzle...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mg-page" style={{ textAlign: "center", paddingTop: 60 }}>
        <p style={{ color: "var(--fbo-danger)" }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="mg-page mg-page--wall">
      {/* Marquee header */}
      <div className="mg-marquee">
        <h1 className="mg-title">Movie Guesser</h1>
        <p className="mg-subtitle">Find today's movie on the wall</p>
      </div>

      {/* Now Showing clue card */}
      <div className="mg-clue-card">
        <div className="mg-clue-label">Released</div>
        <div className="mg-clue-date">{fmtDate(puzzle.release_date)}</div>
        <div className="mg-clue-label">Worldwide Revenue</div>
        <div className="mg-clue-revenue">{fmtRevenue(puzzle.revenue)}</div>
        {overviewTokens.length > 0 && (
          <div className="mg-overview-wrap">
            <div className="mg-clue-label" style={{ marginTop: 14 }}>Overview</div>
            <OverviewDisplay tokens={overviewTokens} revealedMap={revealedMap} winRevealedMap={winRevealedMap} newlyRevealedIndices={newlyRevealedIndices} />
          </div>
        )}
      </div>

      {/* Win state */}
      {won && answer && (
        <div className="mg-win">
          {answer.poster_url && (
            <img src={answer.poster_url} alt={answer.title} className="mg-win-poster" />
          )}
          <h2 className="mg-win-title">{answer.title}</h2>
          <p className="mg-win-score">
            Solved in {guesses.length} guess{guesses.length !== 1 ? "es" : ""}!
          </p>
          {answer.genres && (
            <p className="mg-win-meta">{answer.genres.join(" · ")}</p>
          )}
          {answer.production_companies?.length > 0 && (
            <p className="mg-win-meta">{answer.production_companies.join(" · ")}</p>
          )}
          {answer.top_cast?.length > 0 && (
            <p className="mg-win-meta" style={{ marginBottom: 14 }}>
              {answer.top_cast.slice(0, 5).join(" · ")}
            </p>
          )}
          <button onClick={handleShare} className="mg-share-btn">Copy Results</button>
          <p className="mg-win-countdown">Next puzzle in <Countdown /></p>
        </div>
      )}

      {/* The wall */}
      {!won && (
        <>
          <div className="mg-wall-bar">
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Search the wall..."
              className="mg-wall-search"
            />
            <span className="mg-wall-count">
              {remainingCount} film{remainingCount !== 1 ? "s" : ""} remain{remainingCount === 1 ? "s" : ""}
            </span>
          </div>

          {poolError && (
            <p style={{ color: "var(--fbo-danger)", textAlign: "center" }}>
              The movie wall is unavailable right now — try again shortly.
            </p>
          )}

          {!poolError && (
            <>
              <div className="mg-wall">
                {pageTiles.map((m) => {
                  const dying = dyingIds.has(m.tmdb_id);
                  return (
                    <button
                      key={m.tmdb_id}
                      className={`mg-tile${dying ? " mg-tile--out" : ""}`}
                      onClick={() => !dying && submitGuess(m)}
                      disabled={submitting || dying}
                      title={m.title}
                    >
                      {m.poster_url ? (
                        <img src={tileUrl(m.poster_url)} alt={m.title} loading="lazy" className="mg-tile-poster" />
                      ) : (
                        <span className="mg-tile-fallback">{m.title}</span>
                      )}
                    </button>
                  );
                })}
                {pageTiles.length === 0 && (
                  <p className="mg-wall-empty">No movies match — try clearing the search.</p>
                )}
              </div>

              {pageCount > 1 && (
                <div className="mg-wall-pager">
                  <button onClick={() => setPage(Math.max(0, clampedPage - 1))} disabled={clampedPage === 0}>
                    ◀ Prev
                  </button>
                  <span>Page {clampedPage + 1} / {pageCount}</span>
                  <button onClick={() => setPage(Math.min(pageCount - 1, clampedPage + 1))} disabled={clampedPage >= pageCount - 1}>
                    Next ▶
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Guess history */}
      {guesses.length > 0 && (
        <div>
          <h3 className="mg-guesses-header">Guesses ({guesses.length})</h3>
          <div className="mg-guesses-list">
            {guesses.map((g, i) => (
              <div key={g.tmdb_id} className={`mg-guess ${g.correct ? "mg-guess--correct" : ""}`}>
                <span className={`mg-guess-num ${g.correct ? "mg-guess-num--correct" : "mg-guess-num--wrong"}`}>
                  {i + 1}
                </span>
                {g.poster_url && (
                  <img src={g.poster_url} alt="" className="mg-guess-poster" />
                )}
                <div className="mg-guess-body">
                  <div className="mg-guess-title">{g.title}</div>
                  {!g.correct && <GuessHints guess={g} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* How to play */}
      {!won && guesses.length === 0 && (
        <div className="mg-howto">
          <h3>How to Play</h3>
          <ul>
            <li>One of the movies on the wall was released near the date shown above — find it!</li>
            <li>Tap a poster to guess. Wrong guesses reveal which <b>genres</b>, <b>studios</b>, <b>actors</b>, and <b>rating</b> match — and knock every ruled-out movie off the wall</li>
            <li><b>Runtime</b> and <b>user score</b> hints tell you if the answer is higher or lower</li>
            <li>Matching words from each guess's synopsis fill in the mystery overview</li>
            <li>Fewer guesses = better score. New puzzle every day at midnight</li>
          </ul>
        </div>
      )}

      {won && <StatsPanel stats={stats} />}

      {user?.is_admin && puzzle && (
        <div className="mg-admin-bar">
          <button onClick={resetLocalState} className="mg-admin-btn">
            Reset My Game
          </button>
          <button onClick={async () => {
            const res = await apiGuesserRegenerate();
            if (!res.ok) return;
            resetLocalState();
            window.location.reload();
          }} className="mg-admin-btn">
            New Puzzle
          </button>
        </div>
      )}
    </div>
  );
}
