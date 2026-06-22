import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useUser } from "../useUser";
import { apiGuesserToday, apiGuesserGuess, apiGuesserSearch, apiGuesserComplete, apiGuesserRegenerate } from "../api";
import "../MovieGuesser.css";

const STORAGE_KEY = "fbo_guesser_";
const PLAYER_ID_KEY = "fbo_guesser_player_id";

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

function TitleReveal({ titleLength, revealedPositions, eliminatedLetters, won, answerTitle }) {
  if (won && answerTitle) {
    return (
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div className="mg-letter-grid">
          {answerTitle.split("").map((ch, i) => (
            <span key={i} className="mg-letter mg-letter--won">{ch}</span>
          ))}
        </div>
      </div>
    );
  }

  const revealed = {};
  for (const { index, char } of revealedPositions) {
    revealed[index] = char;
  }

  return (
    <div className="mg-title-reveal">
      <div className="mg-title-reveal-label">Title — {titleLength} characters</div>
      <div className="mg-letter-grid">
        {Array.from({ length: titleLength }, (_, i) => {
          const ch = revealed[i];
          return (
            <span key={i} className={`mg-letter ${ch ? "mg-letter--revealed" : "mg-letter--blank"}`}>
              {ch || "·"}
            </span>
          );
        })}
      </div>
      {eliminatedLetters.length > 0 && (
        <div className="mg-eliminated">
          <span className="mg-eliminated-label">Eliminated:</span>
          {eliminatedLetters.sort().map((l) => (
            <span key={l} className="mg-eliminated-letter">{l.toUpperCase()}</span>
          ))}
        </div>
      )}
    </div>
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

function GuessHints({ guess }) {
  const matchingGenres = new Set(guess.matching_genres || []);
  const matchingCompanies = new Set(guess.matching_companies || []);
  const matchingCast = new Set(guess.matching_cast || []);
  return (
    <div className="mg-hints">
      <HintRow label="Genre" items={guess.guessed_genres || []} matchingSet={matchingGenres} />
      <HintRow label="Studio" items={guess.guessed_companies || []} matchingSet={matchingCompanies} />
      <HintRow label="Cast" items={guess.guessed_cast || []} matchingSet={matchingCast} />
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

function formatSearchResults(results) {
  const titleCounts = {};
  for (const r of results) {
    titleCounts[r.title] = (titleCounts[r.title] || 0) + 1;
  }
  return results.map((r) => ({
    ...r,
    display: titleCounts[r.title] > 1 ? `${r.title} (${r.release_year || "?"})` : r.title,
  }));
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
  const reportedRef = useRef(false);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);

  const searchTimeout = useRef(null);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);

  const { revealedPositions, eliminatedLetters } = useMemo(() => {
    const posMap = {};
    const elimSet = new Set();
    for (const g of guesses) {
      if (g.correct) continue;
      for (const { index, char } of g.revealed_positions || []) {
        posMap[index] = char;
      }
      for (const l of g.eliminated_letters || []) {
        elimSet.add(l);
      }
    }
    return {
      revealedPositions: Object.entries(posMap).map(([i, c]) => ({ index: Number(i), char: c })),
      eliminatedLetters: [...elimSet],
    };
  }, [guesses]);

  useEffect(() => {
    (async () => {
      const res = await apiGuesserToday();
      if (!res.ok) {
        setError(res.data?.error || "Failed to load puzzle");
        setLoading(false);
        return;
      }
      setPuzzle(res.data);
      setStats(res.data.stats);

      const saved = getStoredGame(res.data.game_date);
      if (saved) {
        setGuesses(saved.guesses || []);
        setWon(saved.won || false);
        setAnswer(saved.answer || null);
        reportedRef.current = saved.reported || false;
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const doSearch = useCallback(async (q) => {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const res = await apiGuesserSearch(q);
    if (res.ok) setSearchResults(res.data.results || []);
    setSearching(false);
  }, []);

  const formattedResults = useMemo(() => formatSearchResults(searchResults), [searchResults]);

  function handleInputChange(e) {
    const val = e.target.value;
    setQuery(val);
    setSelectedIdx(-1);
    setShowDropdown(true);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => doSearch(val), 300);
  }

  function handleKeyDown(e) {
    if (!showDropdown || !formattedResults.length) {
      if (e.key === "Enter") e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, formattedResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIdx >= 0 && selectedIdx < formattedResults.length) {
        submitGuess(formattedResults[selectedIdx]);
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  }

  async function submitGuess(movie) {
    if (won || submitting) return;
    if (guesses.some((g) => g.tmdb_id === movie.tmdb_id)) {
      setQuery("");
      setShowDropdown(false);
      return;
    }

    setSubmitting(true);
    setShowDropdown(false);
    setQuery("");

    const playerId = getPlayerId();
    const res = await apiGuesserGuess(movie.tmdb_id, movie.title, playerId);
    if (!res.ok) {
      setSubmitting(false);
      return;
    }

    const guess = {
      tmdb_id: movie.tmdb_id,
      title: movie.title,
      release_year: movie.release_year,
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
      revealed_positions: res.data.revealed_positions || [],
      eliminated_letters: res.data.eliminated_letters || [],
    };

    const newGuesses = [...guesses, guess];
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

      if (!reportedRef.current) {
        const completeRes = await apiGuesserComplete(newGuesses.length, playerId);
        if (completeRes.ok) setStats(completeRes.data.stats);
        reportedRef.current = true;
      }
      storeGame(puzzle.game_date, { guesses: newGuesses, won: true, answer: answerData, reported: true });
    } else {
      storeGame(puzzle.game_date, { guesses: newGuesses, won: false });
    }
    setSubmitting(false);
  }

  async function handleShare() {
    const guessCount = guesses.length;
    const hintsLine = guesses.map((g) => {
      if (g.correct) return "🎬";
      const genre = g.genre_match ? "🟩" : "🟥";
      const company = g.company_match ? "🟩" : "🟥";
      const cast = g.cast_match ? "🟩" : "🟥";
      return `${genre}${company}${cast}`;
    }).join("\n");

    const text = `🎬 FBO Movie Guesser ${puzzle.game_date}\n${guessCount} guess${guessCount !== 1 ? "es" : ""}\n\n${hintsLine}\n\nfantasyboxoffice.pages.dev/guesser`;
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
    <div className="mg-page">
      {/* Marquee header */}
      <div className="mg-marquee">
        <h1 className="mg-title">Movie Guesser</h1>
        <p className="mg-subtitle">Guess the movie from its release date and revenue</p>
      </div>

      {/* Now Showing clue card */}
      <div className="mg-clue-card">
        <div className="mg-clue-label">Released</div>
        <div className="mg-clue-date">{fmtDate(puzzle.release_date)}</div>
        <div className="mg-clue-label">Worldwide Revenue</div>
        <div className="mg-clue-revenue">{fmtRevenue(puzzle.revenue)}</div>
      </div>

      {/* Hangman title reveal */}
      {puzzle.title_length && (
        <TitleReveal
          titleLength={puzzle.title_length}
          revealedPositions={revealedPositions}
          eliminatedLetters={eliminatedLetters}
          won={won}
          answerTitle={answer?.title}
        />
      )}

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

      {/* Search input */}
      {!won && (
        <div ref={dropdownRef} className="mg-search-wrap">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => formattedResults.length && setShowDropdown(true)}
            placeholder="Search for a movie..."
            disabled={submitting}
            className="mg-search-input"
          />
          {showDropdown && formattedResults.length > 0 && (
            <div className="mg-dropdown">
              {formattedResults.map((m, i) => (
                <div key={m.tmdb_id}
                  onClick={() => submitGuess(m)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={`mg-dropdown-item ${i === selectedIdx ? "mg-dropdown-item--selected" : ""}`}>
                  {m.poster_url && (
                    <img src={m.poster_url} alt="" className="mg-dropdown-poster" />
                  )}
                  <span className="mg-dropdown-title">{m.display}</span>
                </div>
              ))}
            </div>
          )}
          {searching && <span className="mg-search-spinner">searching...</span>}
        </div>
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
            <li>A movie was released near the date shown above — guess which one!</li>
            <li>After each wrong guess, you'll see which <b>genres</b>, <b>studios</b>, or <b>actors</b> match</li>
            <li>Letters in the right position get revealed, and eliminated letters are shown</li>
            <li>Fewer guesses = better score. New puzzle every day at midnight</li>
          </ul>
        </div>
      )}

      <StatsPanel stats={stats} />

      {user?.is_admin && puzzle && (
        <div className="mg-admin-bar">
          <button onClick={resetLocalState} className="mg-admin-btn">
            Reset My Game
          </button>
          <button onClick={async () => {
            const res = await apiGuesserRegenerate();
            if (!res.ok) return;
            resetLocalState();
            setPuzzle({
              ...puzzle,
              release_date: res.data.release_date,
              revenue: res.data.revenue,
              title_length: res.data.title_length,
            });
          }} className="mg-admin-btn">
            New Puzzle
          </button>
        </div>
      )}
    </div>
  );
}
