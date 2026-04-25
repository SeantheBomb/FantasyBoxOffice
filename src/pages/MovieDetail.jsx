import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiMovie } from "../api";
import { fullCurrency, profitColor } from "../format";

export default function MovieDetail() {
  const { tmdbId } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiMovie(tmdbId).then((r) => {
      if (cancelled) return;
      if (!r.ok) setErr(r.data?.error || "Failed");
      else setData(r.data);
    });
    return () => { cancelled = true; };
  }, [tmdbId]);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (!data) return <div>Loading...</div>;
  const { movie, owned, dailies, active_auction } = data;
  const latestRevenue = dailies.length ? dailies[dailies.length - 1].domestic_revenue : 0;
  const profit = owned && !owned.is_void ? latestRevenue - (movie.budget || 0) : null;

  return (
    <div style={{ maxWidth: 720 }}>
      <Link to="/catalog">← Catalog</Link>
      <h1>{movie.title}</h1>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {movie.poster_url && <img src={movie.poster_url} alt="" style={{ width: "min(200px, 40%)", borderRadius: 6, flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 180 }}>
          <div>Release: <b>{movie.release_date}</b></div>
          <div>Status: {movie.status}</div>
          <div>Budget: {fullCurrency(movie.budget)}</div>
          <div>Latest revenue: {fullCurrency(latestRevenue)}</div>
          {owned && (
            <div style={{ marginTop: 8 }}>
              Owner: <b>{owned.owner_username}</b> · Paid {owned.purchase_price} pts
              {owned.is_void ? <span style={{ color: "#b00020", marginLeft: 6 }}>VOID</span> : (
                <span style={{ marginLeft: 6, color: profitColor(profit) }}>Profit {fullCurrency(profit)}</span>
              )}
            </div>
          )}
          {active_auction && (
            <div style={{ marginTop: 8 }}>
              <Link to={`/auctions/${active_auction.id}`}>Active auction — current bid {active_auction.current_bid} pts</Link>
            </div>
          )}
        </div>
      </div>

      <h3 style={{ marginTop: 24 }}>Daily box office</h3>
      {dailies.length === 0 ? (
        <div style={{ color: "#888" }}>No dailies yet.</div>
      ) : (
        <div className="fbo-scroll-x">
          <table style={{ width: "100%", background: "white", border: "1px solid #eee", borderRadius: 8, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#666", background: "#fafafa" }}>
                <th style={{ padding: 8 }}>Date</th>
                <th style={{ textAlign: "right", padding: 8, whiteSpace: "nowrap" }}>Cumulative domestic</th>
                <th style={{ padding: 8 }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {dailies.slice().reverse().map((d) => (
                <tr key={d.date} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <td style={{ padding: 8 }}>{d.date}</td>
                  <td style={{ textAlign: "right", padding: 8, whiteSpace: "nowrap" }}>{fullCurrency(d.domestic_revenue)}</td>
                  <td style={{ padding: 8 }}>{d.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
