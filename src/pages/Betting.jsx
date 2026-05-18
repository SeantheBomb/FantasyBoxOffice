import { useState, useEffect } from "react";
import { useUser } from "../useUser";
import { apiBettingCurrent, apiBettingHistory, apiBet } from "../api";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${Number(d)}`;
}

function fmtGross(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + (a / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + Math.round(a / 1e6) + "M";
  return "$" + a.toLocaleString();
}

const PLACE_LABEL = ["1st", "2nd", "3rd"];

function PicksTable({ picks, myPickDiscordId, actual_gross }) {
  const isScored = actual_gross != null;
  const sorted = isScored
    ? [...picks].sort((a, b) => (b.points_awarded ?? -1) - (a.points_awarded ?? -1))
    : picks;

  if (!sorted.length) {
    return <p style={{ color: "#aaa", fontSize: 13, margin: "4px 0 0" }}>No bets yet.</p>;
  }

  return (
    <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginTop: 6 }}>
      <tbody>
        {sorted.map((p, i) => {
          const isMe = myPickDiscordId && p.discord_user_id === myPickDiscordId;
          return (
            <tr key={(p.discord_user_id ?? p.discord_username) + i}
              style={{ background: isMe ? "rgba(245,210,122,0.12)" : "transparent" }}>
              {isScored && (
                <td style={{ width: 28, color: i < 3 ? "#f5d27a" : "#888", fontWeight: i < 3 ? 700 : 400, padding: "2px 4px" }}>
                  {PLACE_LABEL[i] ?? `${i + 1}th`}
                </td>
              )}
              <td style={{ padding: "2px 6px", fontWeight: isMe ? 700 : 400 }}>{p.discord_username}</td>
              <td style={{ padding: "2px 6px", textAlign: "right" }}>${p.estimate}M</td>
              {isScored && (
                <td style={{ padding: "2px 6px", textAlign: "right", color: "#f5d27a" }}>
                  {p.points_awarded != null ? `+${p.points_awarded} pts` : "—"}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BetForm({ movie, onBetPlaced }) {
  const [estimate, setEstimate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const val = estimate.trim().toUpperCase().replace(/^(\d+)M?$/, "$1");
    const num = Number(val);
    if (!Number.isInteger(num) || num <= 0) {
      setError("Enter a whole number in millions (e.g. 45 for $45M)");
      return;
    }
    setSubmitting(true);
    setError("");
    const res = await apiBet(movie.tmdb_id, num);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.data?.error ?? "Failed to place bet");
    } else {
      setEstimate("");
      onBetPlaced();
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#1a0a0a", border: "1px solid #5a2020", borderRadius: 4, padding: "4px 8px" }}>
        <span style={{ color: "#f5d27a", fontWeight: 700 }}>$</span>
        <input
          type="number"
          min="1"
          placeholder="45"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          style={{ width: 64, background: "transparent", border: "none", outline: "none", color: "#f5e8c0", fontSize: 14 }}
          disabled={submitting}
        />
        <span style={{ color: "#888" }}>M</span>
      </div>
      <button
        type="submit"
        disabled={submitting || !estimate}
        style={{ padding: "5px 14px", background: "#f5d27a", color: "#1a0000", border: "none", borderRadius: 4, fontWeight: 700, cursor: submitting ? "wait" : "pointer", fontSize: 13 }}
      >
        {submitting ? "Placing…" : "Place Bet"}
      </button>
      {error && <span style={{ color: "#ef4444", fontSize: 12, width: "100%" }}>{error}</span>}
    </form>
  );
}

function MovieCard({ movie, isOpen, isInLeague, hasAuth, onBetPlaced }) {
  const isScored = movie.actual_gross != null;
  const myPick = movie.my_pick;
  const canBet = isOpen && isInLeague && !myPick;

  return (
    <div style={{
      background: "#1a0a0a",
      border: "1px solid #3a1a1a",
      borderRadius: 8,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{ display: "flex", gap: 12, padding: 12 }}>
        {movie.poster_url ? (
          <img
            src={movie.poster_url}
            alt={movie.title}
            style={{ width: 60, height: 90, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
          />
        ) : (
          <div style={{ width: 60, height: 90, background: "#2a1010", borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 20 }}>🎬</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#f5e8c0", lineHeight: 1.3 }}>{movie.title}</div>
          {movie.owner && <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>Owned by {movie.owner}</div>}
          {movie.release_date && <div style={{ fontSize: 12, color: "#888", marginTop: 1 }}>Opens {fmtDate(movie.release_date)}</div>}
          {isScored && (
            <div style={{ marginTop: 6, background: "#2a1a00", border: "1px solid #5a3a00", borderRadius: 4, padding: "3px 8px", display: "inline-block", fontSize: 13 }}>
              <span style={{ color: "#888" }}>Actual: </span>
              <span style={{ color: "#f5d27a", fontWeight: 700 }}>{fmtGross(movie.actual_gross)}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "0 12px 12px" }}>
        <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Bets</div>
        <PicksTable picks={movie.picks} myPickDiscordId={myPick?.discord_user_id} actual_gross={movie.actual_gross} />
        {myPick && isOpen && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#aaa" }}>
            Your bet: <strong style={{ color: "#f5d27a" }}>${myPick.estimate}M</strong>
          </div>
        )}
        {canBet && hasAuth && (
          <BetForm movie={movie} onBetPlaced={onBetPlaced} />
        )}
        {!hasAuth && isOpen && (
          <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
            <a href="/login" style={{ color: "#f5d27a" }}>Sign in</a> to place a bet.
          </p>
        )}
        {hasAuth && !isInLeague && isOpen && (
          <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>You must be in the league to bet.</p>
        )}
      </div>
    </div>
  );
}

function WeekendSection({ weekend, label, isInLeague, hasAuth, onBetPlaced }) {
  const { weekend_date, is_open, movies } = weekend;
  const scored = movies.some((m) => m.actual_gross != null);

  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#f5e8c0" }}>
          {label ?? `Opening Weekend — ${fmtDate(weekend_date)}`}
        </h2>
        {is_open
          ? <span style={{ fontSize: 12, background: "#10b981", color: "#fff", borderRadius: 12, padding: "2px 8px", fontWeight: 600 }}>Betting Open</span>
          : scored
            ? <span style={{ fontSize: 12, background: "#3b82f6", color: "#fff", borderRadius: 12, padding: "2px 8px", fontWeight: 600 }}>Results In</span>
            : <span style={{ fontSize: 12, background: "#6b7280", color: "#fff", borderRadius: 12, padding: "2px 8px", fontWeight: 600 }}>Betting Closed</span>
        }
      </div>
      {movies.length === 0 ? (
        <p style={{ color: "#888" }}>No movies in lineup yet.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {movies.map((m) => (
            <MovieCard
              key={m.tmdb_id}
              movie={m}
              isOpen={is_open}
              isInLeague={isInLeague}
              hasAuth={hasAuth}
              onBetPlaced={onBetPlaced}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function Betting() {
  const { user } = useUser();
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiBettingCurrent(), apiBettingHistory()]).then(([curRes, histRes]) => {
      if (cancelled) return;
      if (curRes.ok) setCurrent(curRes.data?.weekend ?? null);
      if (histRes.ok) setHistory(histRes.data?.weekends ?? []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);

  function reload() { setRefreshKey((k) => k + 1); }

  const isInLeague = current?.is_in_league ?? false;

  if (loading) return <div style={{ padding: 16 }}><p style={{ color: "#888" }}>Loading…</p></div>;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
      <h1 style={{ marginTop: 0, marginBottom: 24, fontSize: 22, color: "#f5e8c0" }}>🎲 Weekend Predictions</h1>

      {current ? (
        <WeekendSection
          weekend={current}
          label={`Opening Weekend — ${fmtDate(current.weekend_date)}`}
          isInLeague={isInLeague}
          hasAuth={!!user}
          onBetPlaced={reload}
        />
      ) : (
        <p style={{ color: "#888", marginBottom: 32 }}>No active weekend lineup yet — check back soon.</p>
      )}

      {history.length > 0 && (
        <>
          <hr style={{ border: "none", borderTop: "1px solid #3a1a1a", margin: "0 0 32px" }} />
          <h2 style={{ margin: "0 0 20px", fontSize: 18, color: "#f5e8c0" }}>Past Weekends</h2>
          {history.map((w) => (
            <WeekendSection
              key={w.weekend_date}
              weekend={{ ...w, is_open: false }}
              label={`Opening Weekend — ${fmtDate(w.weekend_date)}`}
              isInLeague={false}
              hasAuth={false}
              onBetPlaced={() => {}}
            />
          ))}
        </>
      )}

      {!current && history.length === 0 && (
        <p style={{ color: "#888" }}>No prediction history yet.</p>
      )}
    </div>
  );
}
