import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useUser } from "../useUser";
import { apiGuesserToday, apiGuesserGuess, apiGuesserSearch, apiGuesserComplete } from "../api";

const STORAGE_KEY = "fbo_guesser_";

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

// Hangman-style title display
function TitleReveal({ titleLength, revealedPositions, eliminatedLetters, won, answerTitle }) {
  if (won && answerTitle) {
    return (
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 3 }}>
          {answerTitle.split("").map((ch, i) => (
            <span key={i} style={{
              width: 22, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color: "var(--fbo-success)",
              background: "rgba(99, 211, 122, 0.15)", borderRadius: 3,
              border: "1px solid rgba(99, 211, 122, 0.3)",
            }}>{ch}</span>
          ))}
        </div>
      </div>
    );
  }

  // Build the revealed map from accumulated positions
  const revealed = {};
  for (const { index, char } of revealedPositions) {
    revealed[index] = char;
  }

  return (
    <div style={{
      background: "var(--fbo-bg-card)", borderRadius: 8, padding: 16,
      border: "1px solid var(--fbo-border)", marginBottom: 16,
    }}>
      <div style={{ fontSize: 11, color: "var(--fbo-text-muted)", marginBottom: 8, textAlign: "center" }}>
        Title ({titleLength} characters)
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 3, marginBottom: 12 }}>
        {Array.from({ length: titleLength }, (_, i) => {
          const ch = revealed[i];
          return (
            <span key={i} style={{
              width: 22, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: ch ? 700 : 400,
              color: ch ? "var(--fbo-gold)" : "var(--fbo-text-muted)",
              background: ch ? "rgba(245, 210, 122, 0.12)" : "var(--fbo-bg-panel)",
              borderRadius: 3,
              border: `1px solid ${ch ? "rgba(245, 210, 122, 0.3)" : "var(--fbo-border)"}`,
            }}>
              {ch || "·"}
            </span>
          );
        })}
      </div>
      {eliminatedLetters.length > 0 && (
        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: 11, color: "var(--fbo-text-muted)", marginRight: 6 }}>Not in title:</span>
          {eliminatedLetters.sort().map((l) => (
            <span key={l} style={{
              display: "inline-block", width: 20, height: 20, lineHeight: "20px",
              textAlign: "center", fontSize: 11, fontWeight: 600,
              color: "#ff6b6b", background: "rgba(255, 107, 107, 0.1)",
              borderRadius: 3, margin: "0 2px",
            }}>{l.toUpperCase()}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function HintBadge({ label, match, details }) {
  const displayLabel = match && details?.length
    ? `${label}: ${details.join(", ")}`
    : label;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 12,
      fontWeight: 600,
      background: match ? "rgba(99, 211, 122, 0.15)" : "rgba(255, 107, 107, 0.15)",
      color: match ? "#63d37a" : "#ff6b6b",
      border: `1px solid ${match ? "rgba(99, 211, 122, 0.3)" : "rgba(255, 107, 107, 0.3)"}`,
    }}>
      {match ? "✓" : "✗"} {displayLabel}
    </span>
  );
}

function StatsPanel({ stats }) {
  if (!stats || !stats.total_players) return null;
  const maxCount = Math.max(...stats.distribution.map((d) => d.count), 1);
  return (
    <div style={{
      background: "var(--fbo-bg-card)", borderRadius: 8, padding: 16,
      border: "1px solid var(--fbo-border)", marginTop: 16,
    }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 15, color: "var(--fbo-gold)" }}>
        Today's Stats
      </h3>
      <div style={{ display: "flex", gap: 24, fontSize: 13, marginBottom: 12 }}>
        <span>{stats.total_players} player{stats.total_players !== 1 ? "s" : ""}</span>
        <span>Avg: {stats.avg_guesses} guesses</span>
        <span>Best: {stats.best_score}</span>
      </div>
      {stats.distribution.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {stats.distribution.map((d) => (
            <div key={d.guesses} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ width: 20, textAlign: "right", color: "var(--fbo-text-muted)" }}>{d.guesses}</span>
              <div style={{
                height: 16, borderRadius: 3,
                background: "var(--fbo-gold)",
                width: `${Math.max((d.count / maxCount) * 100, 8)}%`,
                minWidth: 20,
                display: "flex", alignItems: "center", justifyContent: "flex-end",
                paddingRight: 4, fontSize: 11, color: "#1a0000", fontWeight: 600,
              }}>
                {d.count}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Format search results: only show year when there are duplicate titles
function formatSearchResults(results) {
  const titleCounts = {};
  for (const r of results) {
    titleCounts[r.title] = (titleCounts[r.title] || 0) + 1;
  }
  return results.map((r) => ({
    ...r,
    display: titleCounts[r.title] > 1 ? `${r.title} (${r.release_year || "?"})` : r.title,
    showYear: titleCounts[r.title] > 1,
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

  // Search state
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);

  const searchTimeout = useRef(null);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);

  // Accumulate letter hints across all guesses
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

    const res = await apiGuesserGuess(movie.tmdb_id);
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
      revealed_positions: res.data.revealed_positions || [],
      eliminated_letters: res.data.eliminated_letters || [],
    };

    const newGuesses = [...guesses, guess];
    setGuesses(newGuesses);

    if (res.data.correct) {
      setWon(true);
      setAnswer({
        title: res.data.title,
        poster_url: res.data.poster_url,
        release_date: res.data.release_date,
        revenue: res.data.revenue,
        genres: res.data.genres,
      });

      if (!reportedRef.current) {
        const completeRes = await apiGuesserComplete(newGuesses.length);
        if (completeRes.ok) setStats(completeRes.data.stats);
        reportedRef.current = true;
      }
      storeGame(puzzle.game_date, { guesses: newGuesses, won: true, answer: {
        title: res.data.title, poster_url: res.data.poster_url,
        release_date: res.data.release_date, revenue: res.data.revenue, genres: res.data.genres,
      }, reported: true });
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

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ color: "var(--fbo-text-muted)" }}>Loading puzzle...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ color: "var(--fbo-danger)" }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ textAlign: "center", fontSize: 24, color: "var(--fbo-gold)", marginBottom: 4 }}>
        Movie Guesser
      </h1>
      <p style={{ textAlign: "center", color: "var(--fbo-text-muted)", fontSize: 13, margin: "0 0 20px" }}>
        Guess the movie from its release date and box office revenue
      </p>

      {/* Clue card */}
      <div style={{
        background: "var(--fbo-bg-card)", borderRadius: 8, padding: 20,
        border: "1px solid var(--fbo-border)", marginBottom: 16, textAlign: "center",
      }}>
        <div style={{ fontSize: 13, color: "var(--fbo-text-muted)", marginBottom: 4 }}>Released</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--fbo-text)", marginBottom: 12 }}>
          {fmtDate(puzzle.release_date)}
        </div>
        <div style={{ fontSize: 13, color: "var(--fbo-text-muted)", marginBottom: 4 }}>Worldwide Revenue</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--fbo-gold)" }}>
          {fmtRevenue(puzzle.revenue)}
        </div>
      </div>

      {/* Hangman-style title reveal */}
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
        <div style={{
          background: "rgba(99, 211, 122, 0.08)", borderRadius: 8, padding: 20,
          border: "1px solid rgba(99, 211, 122, 0.3)", marginBottom: 20, textAlign: "center",
        }}>
          {answer.poster_url && (
            <img src={answer.poster_url} alt={answer.title}
              style={{ width: 120, borderRadius: 6, marginBottom: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.4)" }} />
          )}
          <h2 style={{ margin: "0 0 4px", fontSize: 20, color: "var(--fbo-success)" }}>
            {answer.title}
          </h2>
          <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--fbo-text-muted)" }}>
            Solved in {guesses.length} guess{guesses.length !== 1 ? "es" : ""}!
          </p>
          {answer.genres && (
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--fbo-text-muted)" }}>
              {answer.genres.join(" · ")}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={handleShare} style={{
              padding: "8px 16px", borderRadius: 4, border: "none", cursor: "pointer",
              background: "var(--fbo-gold)", color: "#1a0000", fontWeight: 700, fontSize: 13,
            }}>
              Copy Results
            </button>
          </div>
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--fbo-text-muted)" }}>
            Next puzzle in <Countdown />
          </p>
        </div>
      )}

      {/* Search input */}
      {!won && (
        <div ref={dropdownRef} style={{ position: "relative", marginBottom: 20 }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => formattedResults.length && setShowDropdown(true)}
            placeholder="Type a movie name..."
            disabled={submitting}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 6,
              border: "1px solid var(--fbo-border)", background: "var(--fbo-bg-panel)",
              color: "var(--fbo-text)", fontSize: 15, outline: "none",
            }}
          />
          {showDropdown && formattedResults.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
              background: "var(--fbo-bg-panel)", border: "1px solid var(--fbo-border)",
              borderRadius: "0 0 6px 6px", maxHeight: 280, overflowY: "auto",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}>
              {formattedResults.map((m, i) => (
                <div key={m.tmdb_id}
                  onClick={() => submitGuess(m)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  style={{
                    padding: "8px 14px", cursor: "pointer", display: "flex",
                    alignItems: "center", gap: 10,
                    background: i === selectedIdx ? "var(--fbo-bg-card)" : "transparent",
                  }}>
                  {m.poster_url && (
                    <img src={m.poster_url} alt="" style={{ width: 28, height: 42, borderRadius: 3, objectFit: "cover" }} />
                  )}
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{m.display}</div>
                </div>
              ))}
            </div>
          )}
          {searching && (
            <div style={{ position: "absolute", right: 12, top: 12, color: "var(--fbo-text-muted)", fontSize: 12 }}>
              searching...
            </div>
          )}
        </div>
      )}

      {/* Guess history */}
      {guesses.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, color: "var(--fbo-text-muted)", margin: "0 0 8px" }}>
            Guesses ({guesses.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {guesses.map((g, i) => (
              <div key={g.tmdb_id} style={{
                background: g.correct ? "rgba(99, 211, 122, 0.08)" : "var(--fbo-bg-card)",
                borderRadius: 6, padding: "10px 14px",
                border: `1px solid ${g.correct ? "rgba(99, 211, 122, 0.3)" : "var(--fbo-border)"}`,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{
                  width: 24, height: 24, borderRadius: "50%", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 12,
                  fontWeight: 700, flexShrink: 0,
                  background: g.correct ? "var(--fbo-success)" : "var(--fbo-bg-panel)",
                  color: g.correct ? "#1a0000" : "var(--fbo-text-muted)",
                }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{g.title}</div>
                  {!g.correct && (
                    <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                      <HintBadge label="Genre" match={g.genre_match} details={g.matching_genres} />
                      <HintBadge label="Studio" match={g.company_match} details={g.matching_companies} />
                      <HintBadge label="Actor" match={g.cast_match} details={g.matching_cast} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* How to play */}
      {!won && guesses.length === 0 && (
        <div style={{
          background: "var(--fbo-bg-card)", borderRadius: 8, padding: 16,
          border: "1px solid var(--fbo-border)", fontSize: 13, color: "var(--fbo-text-muted)",
        }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "var(--fbo-text)" }}>How to Play</h3>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            <li>A movie was released near the date shown above — guess which one!</li>
            <li>After each wrong guess, you'll see which <b>genres</b>, <b>studios</b>, or <b>actors</b> match</li>
            <li>Letters in the right position get revealed, and eliminated letters are shown</li>
            <li>Fewer guesses = better score. New puzzle every day at midnight</li>
          </ul>
        </div>
      )}

      <StatsPanel stats={stats} />

      {user?.is_admin && puzzle && (
        <button onClick={() => {
          localStorage.removeItem(STORAGE_KEY + puzzle.game_date);
          setGuesses([]);
          setWon(false);
          setAnswer(null);
          reportedRef.current = false;
        }} style={{
          marginTop: 16, padding: "6px 14px", borderRadius: 4, border: "1px solid var(--fbo-border)",
          background: "var(--fbo-bg-panel)", color: "var(--fbo-text-muted)", fontSize: 12,
          cursor: "pointer", display: "block", width: "100%",
        }}>
          Reset Today's Game (Admin)
        </button>
      )}
    </div>
  );
}
