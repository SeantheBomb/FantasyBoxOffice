import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiAuctions, apiCreateAuction, apiGameCatalog } from "../api";
import { timeRemaining, fullCurrency } from "../format";
import { useUser } from "../useUser";

export default function AuctionsBrowse() {
  const { refresh } = useUser();
  const [auctions, setAuctions] = useState(null);
  const [err, setErr] = useState("");
  const [version, setVersion] = useState(0);
  const [, setTick] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiAuctions("open").then((r) => {
      if (cancelled) return;
      if (!r.ok) setErr(r.data?.error || "Failed to load auctions");
      else setAuctions(r.data.auctions);
    });
    return () => { cancelled = true; };
  }, [version]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Open Auctions</h1>
        <StartAuctionButton onCreated={() => { reload(); refresh(); }} />
      </div>
      {err && <div style={{ color: "crimson" }}>{err}</div>}
      {!auctions ? <div>Loading...</div> : auctions.length === 0 ? (
        <div style={{ color: "#888", padding: 16 }}>No open auctions. Start one!</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {auctions.map((a) => (
            <Link key={a.id} to={`/auctions/${a.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ background: "white", border: "1px solid #eee", borderRadius: 8, padding: 12, display: "flex", gap: 12 }}>
                {a.poster_url && <img src={a.poster_url} alt="" style={{ width: 70, height: "auto", borderRadius: 4 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{a.title}</div>
                  <div style={{ color: "#666", fontSize: 13 }}>Releases {a.release_date}</div>
                  <div style={{ marginTop: 6 }}>
                    Bid: <b>{a.current_bid}</b> pts ({a.current_bidder_username})
                  </div>
                  <div style={{ fontSize: 13, color: "#333" }}>Ends in: {timeRemaining(a.ends_at)}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>Budget {fullCurrency(a.budget)}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StartAuctionButton({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [unowned, setUnowned] = useState(null);
  const [selected, setSelected] = useState(null);
  const [bid, setBid] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");

  function openPicker() {
    setOpen(true);
    setErr("");
    setUnowned(null);
    apiGameCatalog({ status: "unreleased", owner: "none" }).then((r) => {
      if (!r.ok) setErr(r.data?.error || "Load failed");
      else setUnowned(r.data.movies);
    });
  }

  async function create() {
    if (!selected) return;
    setBusy(true);
    const r = await apiCreateAuction({ tmdbId: selected.tmdb_id, startingBid: Number(bid) });
    setBusy(false);
    if (!r.ok) return setErr(r.data?.error || "Create failed");
    setOpen(false); setSelected(null); setBid(1); setQuery("");
    onCreated?.();
  }

  if (!open) {
    return <button onClick={openPicker}>Start an auction</button>;
  }
  const filtered = unowned ? unowned.filter((m) => m.title.toLowerCase().includes(query.toLowerCase())) : [];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--fbo-bg-panel)", color: "var(--fbo-text)", padding: 20, borderRadius: 8, width: "min(720px, 96vw)", maxHeight: "90vh", overflow: "auto", border: "1px solid var(--fbo-border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Start an auction</h3>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
        {err && <div style={{ color: "var(--fbo-danger)", marginBottom: 8 }}>{err}</div>}
        <input placeholder="Search movie..." value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: "100%", marginTop: 12, marginBottom: 8 }} />
        {!unowned ? <div>Loading...</div> : (
          <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid var(--fbo-border)", borderRadius: 6 }}>
            {filtered.map((m) => {
              const isSel = selected?.tmdb_id === m.tmdb_id;
              return (
                <div key={m.tmdb_id} onClick={() => setSelected(m)}
                  style={{
                    padding: 8,
                    cursor: "pointer",
                    background: isSel ? "var(--fbo-gold)" : "transparent",
                    color: isSel ? "#1a0000" : "var(--fbo-text)",
                    borderBottom: "1px solid var(--fbo-border)",
                  }}>
                  <b>{m.title}</b> · {m.release_date}
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: 8, color: "var(--fbo-text-muted)" }}>No matches.</div>}
          </div>
        )}
        {selected && (
          <div style={{ marginTop: 12 }}>
            <div>Movie: <b>{selected.title}</b></div>
            <label style={{ display: "block", marginTop: 6 }}>
              Starting bid (points):{" "}
              <input type="number" min={1} value={bid} onChange={(e) => setBid(e.target.value)} style={{ width: 100 }} />
            </label>
            <button disabled={busy} onClick={create} style={{ marginTop: 8 }}>
              {busy ? "Starting..." : "Start auction"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
