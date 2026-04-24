import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGameStandings, apiGameHistory } from "../api";
import { fullCurrency, profitColor } from "../format";
import ProfitChart from "../ProfitChart";

export default function Standings() {
  const [standings, setStandings] = useState(null);
  const [history, setHistory] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGameStandings(), apiGameHistory()]).then(([s, h]) => {
      if (cancelled) return;
      if (!s.ok) return setErr(s.data?.error || "Failed to load standings");
      if (!h.ok) return setErr(h.data?.error || "Failed to load history");
      setStandings(s.data);
      setHistory(h.data);
    });
    return () => { cancelled = true; };
  }, []);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (!standings || !history) return <div>Loading standings...</div>;

  return (
    <div>
      <h1>Standings</h1>

      <section style={{ marginBottom: 24 }}>
        <h3>Total Profit Over Time</h3>
        <ProfitChart dates={history.dates} series={history.series} movies={history.movies || []} revenues={history.revenues || {}} />
      </section>

      <section>
        <h3>Current Leaderboard</h3>
        {standings.users.length === 0 && <div>No players yet.</div>}
        {standings.users.map((u, idx) => (
          <div key={u.id} style={{ background: "var(--fbo-bg-card)", border: "1px solid var(--fbo-border)", borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div><b>{idx + 1}. {u.username}</b> <span style={{ color: "var(--fbo-text-muted)" }}>({u.real_name})</span></div>
              <div style={{ fontSize: 20, fontWeight: 600, color: profitColor(u.total_profit) }}>
                {fullCurrency(u.total_profit)}
              </div>
            </div>
            {u.movies.length === 0 ? (
              <div style={{ color: "var(--fbo-text-muted)", marginTop: 8 }}>No movies yet.</div>
            ) : (
              <table style={{ width: "100%", marginTop: 8, fontSize: 14, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--fbo-text-muted)" }}>
                    <th>Movie</th><th>Status</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Budget</th><th style={{ textAlign: "right" }}>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {u.movies.map((m) => (
                    <tr key={m.tmdb_id} style={{ borderTop: "1px solid var(--fbo-border)", opacity: m.is_void ? 0.5 : 1 }}>
                      <td style={{ padding: "4px 0" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {m.poster_url ? (
                            <img src={m.poster_url} alt="" style={posterThumb} />
                          ) : (
                            <div style={posterThumbEmpty}>—</div>
                          )}
                          <Link to={`/movie/${m.tmdb_id}`}>{m.title}</Link>
                          {m.is_void && <span style={{ marginLeft: 6, fontSize: 11, color: "#b00020" }}>VOID</span>}
                        </div>
                      </td>
                      <td>{m.status}</td>
                      <td style={{ textAlign: "right" }}>{fullCurrency(m.revenue)}</td>
                      <td style={{ textAlign: "right" }}>{fullCurrency(m.budget)}</td>
                      <td style={{ textAlign: "right", color: profitColor(m.profit) }}>{fullCurrency(m.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

const posterThumb = {
  width: 32,
  height: 48,
  objectFit: "cover",
  borderRadius: 3,
  boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
  flexShrink: 0,
};
const posterThumbEmpty = {
  width: 32,
  height: 48,
  borderRadius: 3,
  background: "#2a2330",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#5d4d6a",
  fontSize: 18,
  flexShrink: 0,
};
