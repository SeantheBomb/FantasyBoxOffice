import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGameMe, apiVoidMovie } from "../api";
import { fullCurrency, profitColor } from "../format";
import { useUser } from "../useUser";

export default function MyMovies() {
  const { refresh } = useUser();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiGameMe().then((r) => {
      if (cancelled) return;
      if (!r.ok) setErr(r.data?.error || "Failed to load");
      else setData(r.data);
    });
    return () => { cancelled = true; };
  }, [version]);

  async function voidMovie(m) {
    const cost = m.void_cost;
    if (!window.confirm(`Void ${m.title} for ${cost} points?`)) return;
    const r = await apiVoidMovie(m.tmdb_id);
    if (!r.ok) return alert(r.data?.error || "Void failed");
    refresh();
    reload();
  }

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (!data) return <div>Loading...</div>;

  return (
    <div>
      <h1>My Movies</h1>
      <p>
        Points remaining: <b>{data.points_remaining}</b> · Total profit:{" "}
        <b style={{ color: profitColor(data.total_profit) }}>{fullCurrency(data.total_profit)}</b>
      </p>
      {data.movies.length === 0 ? (
        <div style={{ color: "var(--fbo-text-muted)" }}>You don&apos;t own any movies yet. <Link to="/auctions">Go bid on some.</Link></div>
      ) : (
        <table style={{ width: "100%", background: "var(--fbo-bg-card)", border: "1px solid var(--fbo-border)", borderRadius: 8, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--fbo-text-muted)", background: "rgba(255,255,255,0.04)" }}>
              <th style={{ padding: 8 }}>Movie</th>
              <th>Release</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Paid</th>
              <th style={{ textAlign: "right" }}>Revenue</th>
              <th style={{ textAlign: "right" }}>Budget</th>
              <th style={{ textAlign: "right" }}>Profit</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.movies.map((m) => (
              <tr key={m.tmdb_id} style={{ borderTop: "1px solid var(--fbo-border)", opacity: m.is_void ? 0.5 : 1 }}>
                <td style={{ padding: 8 }}>
                  <Link to={`/movie/${m.tmdb_id}`}>{m.title}</Link>
                  {m.is_void && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--fbo-danger)" }}>VOID</span>}
                </td>
                <td>{m.release_date}</td>
                <td>{m.status}</td>
                <td style={{ textAlign: "right" }}>{m.purchase_price} pts</td>
                <td style={{ textAlign: "right" }}>{fullCurrency(m.revenue)}</td>
                <td style={{ textAlign: "right" }}>{fullCurrency(m.budget)}</td>
                <td style={{ textAlign: "right", color: profitColor(m.profit) }}>{fullCurrency(m.profit)}</td>
                <td>
                  {!m.is_void && (
                    <button onClick={() => voidMovie(m)}>Void ({m.void_cost} pts)</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
