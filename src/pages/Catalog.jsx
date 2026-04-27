import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGameCatalog } from "../api";
import { fullCurrency, profitColor } from "../format";

// Default to popularity ≥ 5 so the broader release-type query (which now
// includes limited theatrical) doesn't drown the catalog in unknown indies.
// Players can drop to "all" via the filter dropdown.
const DEFAULT_MIN_POPULARITY = 5;

const SORT_KEYS = {
  title: { type: "string", default: "asc" },
  release_date: { type: "string", default: "asc" },
  status: { type: "string", default: "asc" },
  popularity: { type: "number", default: "desc" },
  owner_username: { type: "string", default: "asc" },
  budget: { type: "number", default: "desc" },
  revenue: { type: "number", default: "desc" },
  profit: { type: "number", default: "desc" },
};

export default function Catalog() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [minPopularity, setMinPopularity] = useState(DEFAULT_MIN_POPULARITY);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "release_date", dir: "asc" });

  useEffect(() => {
    let cancelled = false;
    apiGameCatalog({ status, owner, minPopularity }).then((r) => {
      if (cancelled) return;
      if (!r.ok) setErr(r.data?.error || "Failed to load catalog");
      else setRows(r.data.movies);
    });
    return () => { cancelled = true; };
  }, [status, owner, minPopularity]);

  function toggleSort(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: SORT_KEYS[key].default }
    );
  }

  const visible = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    const filtered = q ? rows.filter((m) => m.title.toLowerCase().includes(q)) : rows;
    const meta = SORT_KEYS[sort.key];
    const dir = sort.dir === "asc" ? 1 : -1;
    const isNumber = meta?.type === "number";
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      // Nulls/empties always sort last regardless of direction.
      const aMissing = av == null || av === "";
      const bMissing = bv == null || bv === "";
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (isNumber) return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, query, sort]);

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
            <SortHeader label="Movie"      sortKey="title"          sort={sort} onSort={toggleSort} style={{ padding: 8 }} />
            <SortHeader label="Release"    sortKey="release_date"   sort={sort} onSort={toggleSort} style={{ padding: "8px 12px" }} />
            <SortHeader label="Status"     sortKey="status"         sort={sort} onSort={toggleSort} style={{ padding: "8px 12px" }} />
            <SortHeader label="Popularity" sortKey="popularity"     sort={sort} onSort={toggleSort} align="right" style={{ padding: "8px 16px" }} />
            <SortHeader label="Owner"      sortKey="owner_username" sort={sort} onSort={toggleSort} style={{ padding: "8px 12px" }} />
            <SortHeader label="Budget"     sortKey="budget"         sort={sort} onSort={toggleSort} align="right" style={{ padding: "8px 12px" }} />
            <SortHeader label="Revenue"    sortKey="revenue"        sort={sort} onSort={toggleSort} align="right" style={{ padding: "8px 12px" }} />
            <SortHeader label="Profit"     sortKey="profit"         sort={sort} onSort={toggleSort} align="right" style={{ padding: "8px 12px" }} />
          </tr>
        </thead>
        <tbody>
          {visible.map((m) => (
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
      {visible.length === 0 && <div style={{ padding: 16, color: "#888" }}>No movies match.</div>}
    </div>
  );
}

function SortHeader({ label, sortKey, sort, onSort, align = "left", style }) {
  const active = sort.key === sortKey;
  const arrow = active ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        ...style,
        textAlign: align,
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
        color: active ? "var(--fbo-gold-soft)" : undefined,
      }}
    >
      {label}{arrow}
    </th>
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
