import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGameCatalog } from "../api";
import { fullCurrency, profitColor } from "../format";

export default function Catalog() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [minPopularity, setMinPopularity] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiGameCatalog({ status, owner, minPopularity }).then((r) => {
      if (cancelled) return;
      if (!r.ok) setErr(r.data?.error || "Failed to load catalog");
      else setRows(r.data.movies);
    });
    return () => { cancelled = true; };
  }, [status, owner, minPopularity]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    return q ? rows.filter((m) => m.title.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (!rows) return <div>Loading catalog...</div>;

  return (
    <div>
      <h1>Catalog</h1>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <label>
          Status{" "}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">all</option>
            <option value="unreleased">unreleased</option>
            <option value="released">released</option>
            <option value="complete">complete</option>
          </select>
        </label>
        <label>
          Owner{" "}
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">all</option>
            <option value="any">owned</option>
            <option value="none">unowned</option>
          </select>
        </label>
        <label>
          Min popularity{" "}
          <select value={minPopularity} onChange={(e) => setMinPopularity(Number(e.target.value))}>
            <option value="0">all</option>
            <option value="1">1+</option>
            <option value="5">5+</option>
            <option value="10">10+</option>
            <option value="25">25+</option>
            <option value="50">50+</option>
          </select>
        </label>
        <input
          placeholder="Search title"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 120 }}
        />
      </div>
      <div className="fbo-scroll-x">
      <table style={{ width: "100%", background: "var(--fbo-bg-card)", border: "1px solid var(--fbo-border)", borderRadius: 8, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--fbo-text-muted)", background: "rgba(255,255,255,0.04)" }}>
            <th style={{ padding: 8 }}>Movie</th>
            <th style={{ padding: "8px 12px" }}>Release</th>
            <th style={{ padding: "8px 12px" }}>Status</th>
            <th style={{ textAlign: "right", padding: "8px 16px" }}>Popularity</th>
            <th style={{ padding: "8px 12px" }}>Owner</th>
            <th style={{ textAlign: "right", padding: "8px 12px" }}>Budget</th>
            <th style={{ textAlign: "right", padding: "8px 12px" }}>Revenue</th>
            <th style={{ textAlign: "right", padding: "8px 12px" }}>Profit</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => (
            <tr key={m.tmdb_id} style={{ borderTop: "1px solid var(--fbo-border)", opacity: m.is_void ? 0.5 : 1 }}>
              <td style={{ padding: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {m.poster_url ? (
                    <img src={m.poster_url} alt="" style={posterThumb} />
                  ) : (
                    <div style={posterThumbEmpty}>—</div>
                  )}
                  <Link to={`/movie/${m.tmdb_id}`}>{m.title}</Link>
                  {m.is_void && <span style={{ marginLeft: 6, fontSize: 11, color: "#b00020" }}>VOID</span>}
                </div>
              </td>
              <td style={{ padding: "8px 12px" }}>{m.release_date}</td>
              <td style={{ padding: "8px 12px" }}>{m.status}</td>
              <td style={{ textAlign: "right", padding: "8px 16px" }}>{m.popularity ? m.popularity.toFixed(1) : "—"}</td>
              <td style={{ padding: "8px 12px" }}>{m.owner_username || <span style={{ color: "#999" }}>—</span>}</td>
              <td style={{ textAlign: "right", padding: "8px 12px" }}>{fullCurrency(m.budget)}</td>
              <td style={{ textAlign: "right", padding: "8px 12px" }}>{fullCurrency(m.revenue)}</td>
              <td style={{ textAlign: "right", padding: "8px 12px", color: profitColor(m.profit) }}>{fullCurrency(m.profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {filtered.length === 0 && <div style={{ padding: 16, color: "#888" }}>No movies match.</div>}
    </div>
  );
}

const posterThumb = {
  width: 36,
  height: 54,
  objectFit: "cover",
  borderRadius: 3,
  boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
  flexShrink: 0,
};
const posterThumbEmpty = {
  width: 36,
  height: 54,
  borderRadius: 3,
  background: "#2a2330",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#5d4d6a",
  fontSize: 18,
  flexShrink: 0,
};
