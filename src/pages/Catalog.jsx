import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGameCatalog } from "../api";
import { fullCurrency, profitColor } from "../format";

export default function Catalog() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiGameCatalog({ status, owner }).then((r) => {
      if (cancelled) return;
      if (!r.ok) setErr(r.data?.error || "Failed to load catalog");
      else setRows(r.data.movies);
    });
    return () => { cancelled = true; };
  }, [status, owner]);

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
        <input
          placeholder="Search title"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
      </div>
      <table style={{ width: "100%", background: "white", border: "1px solid #eee", borderRadius: 8, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#666", background: "#fafafa" }}>
            <th style={{ padding: 8 }}>Movie</th>
            <th>Release</th>
            <th>Status</th>
            <th>Owner</th>
            <th style={{ textAlign: "right" }}>Budget</th>
            <th style={{ textAlign: "right" }}>Revenue</th>
            <th style={{ textAlign: "right" }}>Profit</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => (
            <tr key={m.tmdb_id} style={{ borderTop: "1px solid #f0f0f0", opacity: m.is_void ? 0.5 : 1 }}>
              <td style={{ padding: 8 }}>
                <Link to={`/movie/${m.tmdb_id}`}>{m.title}</Link>
                {m.is_void && <span style={{ marginLeft: 6, fontSize: 11, color: "#b00020" }}>VOID</span>}
              </td>
              <td>{m.release_date}</td>
              <td>{m.status}</td>
              <td>{m.owner_username || <span style={{ color: "#999" }}>—</span>}</td>
              <td style={{ textAlign: "right" }}>{fullCurrency(m.budget)}</td>
              <td style={{ textAlign: "right" }}>{fullCurrency(m.revenue)}</td>
              <td style={{ textAlign: "right", color: profitColor(m.profit) }}>{fullCurrency(m.profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && <div style={{ padding: 16, color: "#888" }}>No movies match.</div>}
    </div>
  );
}
