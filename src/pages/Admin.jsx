import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiAdminUsers, apiAdminGrantPoints, apiAdminSetAdmin,
  apiAdminRefreshMovies, apiAdminAddMovie, apiAdminRefreshDailies, apiAdminBackfillDailies, apiAdminAddDaily,
  apiAdminBackfillBudgets, apiAdminImportTsv,
  apiAdminUpdateProfile, apiAdminResetPassword, apiAdminSetInLeague,
  apiAdminPostStandingsToDiscord,
  apiAdminRecordAuction,
  apiAdminRevokeMovie,
  apiAdminSetBudget,
  apiAuctions, apiAdminEditAuction, apiAdminDeleteAuction, apiAdminAuditAuction, apiAdminDeleteBid,
  apiGameCatalog,
  apiAdminWeekendScore, apiAdminScoreMovie,
  apiAdminSuggestLineup, apiAdminSetWeekendMovies, apiAdminPostWeekendAnnouncement, apiAdminPostLastCall,
  apiAdminUpdatePick, apiAdminDeletePick, apiAdminCreatePick,
  apiBettingHistory,
} from "../api";
import { useUser } from "../useUser";

export default function Admin() {
  const { user, loading } = useUser();
  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Sign in first.</div>;
  if (!user.is_admin) return <div>Admin only.</div>;
  return (
    <div>
      <h1>Admin</h1>
      <UpdatesPanel />
      <WeekendPanel />
      <PredictionPointsLog />
      <AddMoviePanel />
      <RecordAuctionPanel />
      <RevokeMoviePanel />
      <ImportPanel />
      <UsersPanel />
      <AuctionsPanel />
      <SetBudgetPanel />
      <ManualDailyPanel />
    </div>
  );
}

function RecordAuctionPanel() {
  const [movies, setMovies] = useState(null);
  const [users, setUsers] = useState(null);
  const [movieQuery, setMovieQuery] = useState("");
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [winnerId, setWinnerId] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiGameCatalog({ status: "all", owner: "none" }).then((r) => {
      if (!cancelled && r.ok) setMovies(r.data.movies);
    });
    apiAdminUsers().then((r) => {
      if (!cancelled && r.ok) setUsers(r.data.users);
    });
    return () => { cancelled = true; };
  }, [version]);

  const matches = useMemo(() => {
    if (!movies) return [];
    const q = movieQuery.trim().toLowerCase();
    if (!q) return movies.slice(0, 50);
    return movies.filter((m) => m.title.toLowerCase().includes(q)).slice(0, 50);
  }, [movies, movieQuery]);

  async function submit(e) {
    e.preventDefault();
    setResult(null);
    if (!selectedMovie) return setResult({ error: "Pick a movie" });
    if (!winnerId) return setResult({ error: "Pick a winner" });
    const p = Number(price);
    if (!Number.isFinite(p) || p < 0) return setResult({ error: "Price must be ≥ 0" });

    setBusy(true);
    const r = await apiAdminRecordAuction({
      tmdbId: selectedMovie.tmdb_id,
      winnerUserId: winnerId,
      purchasePrice: p,
    });
    setBusy(false);
    if (r.ok) {
      setResult({ ok: true, ...r.data });
      setSelectedMovie(null);
      setMovieQuery("");
      setWinnerId("");
      setPrice("");
      setVersion((v) => v + 1);
    } else {
      setResult({ error: r.data?.error || `Failed (${r.status})` });
    }
  }

  return (
    <section style={card}>
      <h3>Record auction result</h3>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        For auctions still happening in Discord. Saves ownership and deducts the winner's
        points. The movie will appear in their My Movies and standings immediately.
      </p>
      <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        <div>
          <label style={{ display: "block", marginBottom: 4 }}>Movie</label>
          {selectedMovie ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span><b>{selectedMovie.title}</b> · {selectedMovie.release_date}</span>
              <button type="button" onClick={() => { setSelectedMovie(null); setMovieQuery(""); }}>Change</button>
            </div>
          ) : (
            <>
              <input
                placeholder="Search unowned movies..."
                value={movieQuery}
                onChange={(e) => setMovieQuery(e.target.value)}
                style={{ width: "100%", maxWidth: 420 }}
              />
              {!movies ? <div style={{ marginTop: 6, color: "var(--fbo-text-muted)" }}>Loading...</div> : (
                <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid var(--fbo-border)", borderRadius: 4, marginTop: 6 }}>
                  {matches.length === 0 ? (
                    <div style={{ padding: 8, color: "var(--fbo-text-muted)" }}>No matches.</div>
                  ) : matches.map((m) => (
                    <div
                      key={m.tmdb_id}
                      onClick={() => setSelectedMovie(m)}
                      style={{ padding: 6, cursor: "pointer", borderBottom: "1px solid var(--fbo-border)" }}
                    >
                      <b>{m.title}</b> · <span style={{ color: "var(--fbo-text-muted)" }}>{m.release_date}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            Winner{" "}
            <select value={winnerId} onChange={(e) => setWinnerId(e.target.value)} style={{ minWidth: 160 }}>
              <option value="">— pick a user —</option>
              {users && users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} ({u.points_remaining} pts)
                </option>
              ))}
            </select>
          </label>
          <label>
            Winning bid (pts){" "}
            <input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              style={{ width: 110 }}
            />
          </label>
          <button type="submit" disabled={busy || !selectedMovie || !winnerId || price === ""}>
            {busy ? "Saving..." : "Save result"}
          </button>
        </div>
        {result?.ok && (
          <div style={{ color: "var(--fbo-success)" }}>
            Saved: <b>{result.movie.title}</b> → <b>{result.winner.username}</b> for {result.purchase_price} pts
          </div>
        )}
        {result?.error && <div style={{ color: "var(--fbo-danger)" }}>{result.error}</div>}
      </form>
    </section>
  );
}

function RevokeMoviePanel() {
  const [movies, setMovies] = useState(null);
  const [movieQuery, setMovieQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiGameCatalog({ owner: "any" }).then((r) => {
      if (!cancelled && r.ok) setMovies(r.data.movies);
    });
    return () => { cancelled = true; };
  }, [version]);

  const matches = useMemo(() => {
    if (!movies) return [];
    const q = movieQuery.trim().toLowerCase();
    if (!q) return movies.slice(0, 50);
    return movies.filter((m) => m.title.toLowerCase().includes(q)).slice(0, 50);
  }, [movies, movieQuery]);

  async function submit(e) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setResult(null);
    const r = await apiAdminRevokeMovie(selected.tmdb_id);
    setBusy(false);
    if (r.ok) {
      setResult({ ok: true, ...r.data });
      setSelected(null);
      setMovieQuery("");
      setVersion((v) => v + 1);
    } else {
      setResult({ error: r.data?.error || `Failed (${r.status})` });
    }
  }

  return (
    <section style={card}>
      <h3>Revoke movie ownership</h3>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        Removes the movie from the owner and refunds their points. Use to correct
        a mistaken auction result.
      </p>
      <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        <div>
          <label style={{ display: "block", marginBottom: 4 }}>Movie</label>
          {selected ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>
                <b>{selected.title}</b> · owned by <b>{selected.owner_username}</b> · {selected.purchase_price} pts
              </span>
              <button type="button" onClick={() => { setSelected(null); setMovieQuery(""); }}>Change</button>
            </div>
          ) : (
            <>
              <input
                placeholder="Search owned movies..."
                value={movieQuery}
                onChange={(e) => setMovieQuery(e.target.value)}
                style={{ width: "100%", maxWidth: 420 }}
              />
              {!movies ? <div style={{ marginTop: 6, color: "var(--fbo-text-muted)" }}>Loading...</div> : (
                <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid var(--fbo-border)", borderRadius: 4, marginTop: 6 }}>
                  {matches.length === 0 ? (
                    <div style={{ padding: 8, color: "var(--fbo-text-muted)" }}>No matches.</div>
                  ) : matches.map((m) => (
                    <div
                      key={m.tmdb_id}
                      onClick={() => setSelected(m)}
                      style={{ padding: 6, cursor: "pointer", borderBottom: "1px solid var(--fbo-border)" }}
                    >
                      <b>{m.title}</b> · <span style={{ color: "var(--fbo-text-muted)" }}>{m.release_date}</span>
                      {" · "}<span style={{ color: "var(--fbo-text-muted)" }}>owned by {m.owner_username} ({m.purchase_price} pts)</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div>
          <button type="submit" disabled={busy || !selected} style={{ background: "var(--fbo-danger)", color: "#fff", border: "none", borderRadius: 4, padding: "6px 16px", cursor: "pointer" }}>
            {busy ? "Revoking..." : `Revoke${selected ? ` & refund ${selected.purchase_price} pts` : ""}`}
          </button>
        </div>
        {result?.ok && (
          <div style={{ color: "var(--fbo-success)" }}>
            Revoked: <b>{result.movie.title}</b> — {result.refunded} pts refunded
          </div>
        )}
        {result?.error && <div style={{ color: "var(--fbo-danger)" }}>{result.error}</div>}
      </form>
    </section>
  );
}

function AddMoviePanel() {
  const [tmdbId, setTmdbId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setResult(null);
    const id = Number(tmdbId);
    if (!Number.isInteger(id) || id <= 0) return setResult({ error: "Enter a numeric TMDB id" });
    setBusy(true);
    const r = await apiAdminAddMovie(id);
    setBusy(false);
    if (r.ok) {
      setResult({ ok: true, movie: r.data.movie });
      setTmdbId("");
    } else {
      setResult({ error: r.data?.error || `Failed (${r.status})` });
    }
  }

  return (
    <section style={card}>
      <h3>Add movie by TMDB id</h3>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        Escape hatch for titles that don't show up in the discover query
        (foreign-only, festival pickups, etc.). Find the id in the TMDB
        URL: <code>themoviedb.org/movie/<b>123456</b></code>.
      </p>
      <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="TMDB id"
          value={tmdbId}
          onChange={(e) => setTmdbId(e.target.value)}
          style={{ width: "min(160px, 100%)" }}
        />
        <button type="submit" disabled={busy || !tmdbId}>
          {busy ? "Adding..." : "Add to catalog"}
        </button>
        {result?.ok && (
          <span style={{ color: "var(--fbo-success)" }}>
            Added: <b>{result.movie.title}</b> ({result.movie.release_date})
          </span>
        )}
        {result?.error && <span style={{ color: "var(--fbo-danger)" }}>{result.error}</span>}
      </form>
    </section>
  );
}

function UpdatesPanel() {
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState("");
  async function run(label, fn) {
    setBusy(label);
    const r = await fn();
    setBusy("");
    setLog((l) => [{ label, result: r.data || r.raw, at: new Date().toLocaleTimeString() }, ...l]);
  }
  return (
    <section style={card}>
      <h3>Scheduled jobs</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button disabled={!!busy} onClick={() => run("Movies refresh", apiAdminRefreshMovies)}>
          {busy === "Movies refresh" ? "Running..." : "Run Update Movies"}
        </button>
        <button disabled={!!busy} onClick={() => run("Dailies refresh", apiAdminRefreshDailies)}>
          {busy === "Dailies refresh" ? "Running..." : "Run Update Dailies"}
        </button>
        <button disabled={!!busy} onClick={() => run("Dailies backfill", apiAdminBackfillDailies)}>
          {busy === "Dailies backfill" ? "Running..." : "Backfill Historical Dailies"}
        </button>
        <button disabled={!!busy} onClick={() => run("Backfill budgets", apiAdminBackfillBudgets)}>
          {busy === "Backfill budgets" ? "Running..." : "Backfill Budgets"}
        </button>
        <button disabled={!!busy} onClick={() => run("Discord standings post", apiAdminPostStandingsToDiscord)}>
          {busy === "Discord standings post" ? "Posting..." : "Post Standings to Discord"}
        </button>
      </div>
      {log.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, fontFamily: "monospace" }}>
          {log.map((l, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              [{l.at}] <b>{l.label}:</b> {JSON.stringify(l.result)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ImportPanel() {
  const [tsv, setTsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function doImport() {
    if (!tsv.trim()) return;
    setBusy(true);
    const r = await apiAdminImportTsv(tsv);
    setBusy(false);
    setResult(r.data || { error: r.raw || "Request failed" });
  }

  return (
    <section style={card}>
      <h3>Import League from Spreadsheet (TSV)</h3>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        Paste the full TSV export of your current game. Players not yet
        registered are created as placeholder accounts you can reassign later.
        Movies are matched by title against the catalog — unmatched titles are
        listed in the response.
      </p>
      <textarea
        value={tsv}
        onChange={(e) => setTsv(e.target.value)}
        placeholder="Paste TSV here..."
        style={{ width: "100%", minHeight: 160, fontFamily: "monospace", fontSize: 12 }}
      />
      <div style={{ marginTop: 8 }}>
        <button disabled={busy || !tsv.trim()} onClick={doImport}>
          {busy ? "Importing..." : "Import"}
        </button>
      </div>
      {result && (
        <pre style={{ marginTop: 12, fontSize: 12, background: "#fafafa", padding: 12, borderRadius: 6, overflow: "auto" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </section>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiAdminUsers().then((r) => {
      if (cancelled) return;
      if (r.ok) setUsers(r.data.users);
    });
    return () => { cancelled = true; };
  }, [version]);

  async function grant(userId) {
    const raw = window.prompt("Points delta (+/-)", "10");
    const delta = Number(raw);
    if (!Number.isInteger(delta)) return;
    const r = await apiAdminGrantPoints(userId, delta);
    if (!r.ok) return alert(r.data?.error);
    reload();
  }
  async function toggleAdmin(u) {
    if (!window.confirm(`${u.is_admin ? "Revoke admin from" : "Grant admin to"} ${u.username}?`)) return;
    const r = await apiAdminSetAdmin(u.id, !u.is_admin);
    if (!r.ok) return alert(r.data?.error);
    reload();
  }
  async function editUser(u) {
    const username = window.prompt("Username", u.username);
    if (username == null) return;
    const email = window.prompt("Email", u.email);
    if (email == null) return;
    const discordUserId = window.prompt(
      "Discord User ID (right-click user in Discord → Copy User ID)\nLeave blank to clear.",
      u.discord_user_id || ""
    );
    if (discordUserId == null) return;
    const r = await apiAdminUpdateProfile(u.id, { username, email, discord_user_id: discordUserId || null });
    if (!r.ok) return alert(r.data?.error);
    reload();
  }
  async function resetPassword(u) {
    if (!window.confirm(`Reset password for ${u.username}? A new temporary password will be generated.`)) return;
    const r = await apiAdminResetPassword(u.id);
    if (!r.ok) return alert(r.data?.error);
    window.prompt(
      `New temporary password for ${u.username}. Share via Discord and ask them to change it in My Account.`,
      r.data.temporary_password
    );
  }
  async function toggleInLeague(u) {
    const action = u.in_league ? "Remove from" : "Add to";
    if (!window.confirm(`${action} league standings for ${u.username}?`)) return;
    const r = await apiAdminSetInLeague(u.id, !u.in_league);
    if (!r.ok) return alert(r.data?.error);
    reload();
  }

  return (
    <section style={card}>
      <h3>Users</h3>
      {!users ? <div>Loading...</div> : (
        <div className="fbo-scroll-x">
          <table style={tbl}>
            <thead>
              <tr style={thRow}>
                <th style={th}>Username</th>
                <th style={th}>Real name</th>
                <th style={th}>Email</th>
                <th style={thRight}>Points</th>
                <th style={thRight}>Owned</th>
                <th style={th}>Discord ID</th>
                <th style={th}>Admin</th>
                <th style={th}>In League</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <td style={td}>{u.username}</td>
                  <td style={td}>{u.real_name}</td>
                  <td style={td}>{u.email}</td>
                  <td style={tdRight}>{u.points_remaining}</td>
                  <td style={tdRight}>{u.owned_count}</td>
                  <td style={td}>{u.discord_user_id ? <code style={{ fontSize: 11 }}>{u.discord_user_id}</code> : <span style={{ color: "var(--fbo-text-muted)" }}>—</span>}</td>
                  <td style={td}>{u.is_admin ? "yes" : "no"}</td>
                  <td style={td}>{u.in_league ? "yes" : "no"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button onClick={() => grant(u.id)}>± points</button>{" "}
                    <button onClick={() => editUser(u)}>Edit</button>{" "}
                    <button onClick={() => resetPassword(u)}>Reset pw</button>{" "}
                    <button onClick={() => toggleAdmin(u)}>{u.is_admin ? "Revoke admin" : "Make admin"}</button>{" "}
                    <button onClick={() => toggleInLeague(u)}>{u.in_league ? "Remove from league" : "Add to league"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AuctionsPanel() {
  const [auctions, setAuctions] = useState(null);
  const [auditId, setAuditId] = useState(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiAuctions("all").then((r) => {
      if (cancelled) return;
      if (r.ok) setAuctions(r.data.auctions);
    });
    return () => { cancelled = true; };
  }, [version]);

  async function del(a) {
    if (!window.confirm(`Delete auction for ${a.title}?`)) return;
    const r = await apiAdminDeleteAuction(a.id);
    if (!r.ok) return alert(r.data?.error);
    reload();
  }

  return (
    <section style={card}>
      <h3>Auctions</h3>
      {!auctions ? <div>Loading...</div> : (
        <>
          <div className="fbo-scroll-x">
            <table style={tbl}>
              <thead>
                <tr style={thRow}>
                  <th style={th}>Movie</th>
                  <th style={th}>Status</th>
                  <th style={thRight}>Bid</th>
                  <th style={th}>Bidder</th>
                  <th style={{ ...th, whiteSpace: "nowrap" }}>Ends</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {auctions.map((a) => (
                  <tr key={a.id} style={{ borderTop: "1px solid #f0f0f0", background: auditId === a.id ? "#fffbe6" : undefined }}>
                    <td style={td}>{a.title}</td>
                    <td style={td}>{a.status}</td>
                    <td style={tdRight}>{a.current_bid}</td>
                    <td style={td}>{a.current_bidder_username}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{a.ends_at}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <button onClick={() => setAuditId(auditId === a.id ? null : a.id)}>
                        {auditId === a.id ? "Close" : "Audit"}
                      </button>{" "}
                      <button onClick={() => del(a)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {auditId && (
            <AuctionAuditView
              auctionId={auditId}
              onClose={() => setAuditId(null)}
              onSaved={reload}
            />
          )}
        </>
      )}
    </section>
  );
}

function AuctionAuditView({ auctionId, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [users, setUsers] = useState(null);
  const [version, setVersion] = useState(0);
  const [patchBid, setPatchBid] = useState("");
  const [patchBidder, setPatchBidder] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiAdminAuditAuction(auctionId).then((r) => {
      if (!cancelled && r.ok) {
        setData(r.data);
        setPatchBid(String(r.data.auction.current_bid));
        setPatchBidder(r.data.auction.current_bidder_id);
      }
    });
    apiAdminUsers().then((r) => {
      if (!cancelled && r.ok) setUsers(r.data.users);
    });
    return () => { cancelled = true; };
  }, [auctionId, version]);

  async function deleteBid(bid) {
    if (!window.confirm(`Delete bid of ${bid.amount} pts by ${bid.username}?`)) return;
    const r = await apiAdminDeleteBid(auctionId, bid.id);
    if (!r.ok) return alert(r.data?.error || "Failed");
    setVersion((v) => v + 1);
    onSaved();
  }

  async function saveCorrection(e) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const r = await apiAdminEditAuction(auctionId, {
      current_bid: Number(patchBid),
      current_bidder_id: patchBidder,
    });
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: "Corrected." });
      setVersion((v) => v + 1);
      onSaved();
    } else {
      setMsg({ error: r.data?.error || "Failed" });
    }
  }

  if (!data) return <div style={{ padding: 12, color: "var(--fbo-text-muted)" }}>Loading bid history...</div>;
  const { auction, bids, passes } = data;

  return (
    <div style={{ marginTop: 12, padding: 12, background: "#fffbe6", border: "1px solid #e8d84a", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>Bid history — {auction.title}</strong>
        <button style={{ fontSize: 11 }} onClick={onClose}>Close ✕</button>
      </div>

      <div className="fbo-scroll-x">
        <table style={{ ...tbl, fontSize: 13 }}>
          <thead>
            <tr style={thRow}>
              <th style={th}>#</th>
              <th style={th}>User</th>
              <th style={thRight}>Pts</th>
              <th style={th}>Time</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bids.map((b, i) => (
              <tr key={b.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                <td style={{ ...td, color: "var(--fbo-text-muted)", fontSize: 11 }}>{i + 1}</td>
                <td style={td}>{b.username}</td>
                <td style={tdRight}><b>{b.amount}</b></td>
                <td style={{ ...td, fontSize: 12, color: "var(--fbo-text-muted)", whiteSpace: "nowrap" }}>
                  {new Date(b.bid_at).toLocaleString()}
                </td>
                <td style={td}>
                  <button
                    style={{ fontSize: 11, color: "var(--fbo-danger)", border: "1px solid var(--fbo-danger)", background: "transparent", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}
                    onClick={() => deleteBid(b)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {bids.length === 0 && (
              <tr><td colSpan={5} style={{ ...td, color: "var(--fbo-text-muted)" }}>No bids recorded.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {passes.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--fbo-text-muted)" }}>
          Passes: {passes.map((p) => p.username).join(", ")}
        </div>
      )}

      <form onSubmit={saveCorrection} style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid #e8d84a", paddingTop: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Set correct state:</span>
        <label style={{ fontSize: 13 }}>
          Current bid{" "}
          <input
            type="number"
            min={1}
            value={patchBid}
            onChange={(e) => setPatchBid(e.target.value)}
            style={{ width: 70, marginLeft: 4 }}
          />
          {" "}pts
        </label>
        <label style={{ fontSize: 13 }}>
          Current bidder{" "}
          <select value={patchBidder} onChange={(e) => setPatchBidder(e.target.value)} style={{ minWidth: 140, marginLeft: 4 }}>
            {users
              ? users.filter((u) => u.in_league).map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))
              : <option>Loading…</option>}
          </select>
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save correction"}
        </button>
        {msg?.ok && <span style={{ color: "var(--fbo-success)", fontSize: 13 }}>{msg.ok}</span>}
        {msg?.error && <span style={{ color: "var(--fbo-danger)", fontSize: 13 }}>{msg.error}</span>}
      </form>
    </div>
  );
}

function SetBudgetPanel() {
  const [movies, setMovies] = useState(null);
  const [movieQuery, setMovieQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Show all owned released/complete movies — those are the ones needing a budget estimate.
    apiGameCatalog({ owner: "any" }).then((r) => {
      if (!cancelled && r.ok) setMovies(r.data.movies.filter((m) => m.status !== "unreleased"));
    });
    return () => { cancelled = true; };
  }, []);

  const matches = useMemo(() => {
    if (!movies) return [];
    const q = movieQuery.trim().toLowerCase();
    if (!q) return movies.slice(0, 50);
    return movies.filter((m) => m.title.toLowerCase().includes(q)).slice(0, 50);
  }, [movies, movieQuery]);

  async function submit(e) {
    e.preventDefault();
    if (!selected) return;
    const b = Number(budget);
    if (!Number.isFinite(b) || b < 0) return setResult({ error: "Budget must be ≥ 0" });
    setBusy(true);
    setResult(null);
    const r = await apiAdminSetBudget(selected.tmdb_id, b);
    setBusy(false);
    if (r.ok) {
      setResult({ ok: true, ...r.data });
      setSelected(null);
      setMovieQuery("");
      setBudget("");
    } else {
      setResult({ error: r.data?.error || `Failed (${r.status})` });
    }
  }

  return (
    <section style={card}>
      <h3>Set placeholder budget</h3>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        For released movies where TMDB hasn't published a budget yet. Marked as an
        estimate — the daily TMDB refresh will automatically replace it once the
        official figure appears.
      </p>
      <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        <div>
          <label style={{ display: "block", marginBottom: 4 }}>Movie</label>
          {selected ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>
                <b>{selected.title}</b>
                {selected.budget > 0
                  ? <> · current budget: <b>${(selected.budget / 1e6).toFixed(1)}M</b>{selected.budget_is_placeholder ? " *(est.)*" : ""}</>
                  : " · no budget set"}
              </span>
              <button type="button" onClick={() => { setSelected(null); setMovieQuery(""); }}>Change</button>
            </div>
          ) : (
            <>
              <input
                placeholder="Search released movies..."
                value={movieQuery}
                onChange={(e) => setMovieQuery(e.target.value)}
                style={{ width: "100%", maxWidth: 420 }}
              />
              {!movies ? <div style={{ marginTop: 6, color: "var(--fbo-text-muted)" }}>Loading...</div> : (
                <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid var(--fbo-border)", borderRadius: 4, marginTop: 6 }}>
                  {matches.length === 0 ? (
                    <div style={{ padding: 8, color: "var(--fbo-text-muted)" }}>No matches.</div>
                  ) : matches.map((m) => (
                    <div
                      key={m.tmdb_id}
                      onClick={() => { setSelected(m); setBudget(m.budget > 0 ? String(m.budget) : ""); }}
                      style={{ padding: 6, cursor: "pointer", borderBottom: "1px solid var(--fbo-border)" }}
                    >
                      <b>{m.title}</b>
                      <span style={{ color: "var(--fbo-text-muted)" }}>
                        {" · "}{m.release_date}
                        {m.budget > 0
                          ? <> · ${(m.budget / 1e6).toFixed(1)}M{m.budget_is_placeholder ? " est." : ""}</>
                          : " · no budget"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label>
            Estimated budget ($){" "}
            <input
              type="number"
              min={0}
              step={1000000}
              placeholder="e.g. 50000000"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              style={{ width: 160 }}
            />
          </label>
          <button type="submit" disabled={busy || !selected || budget === ""}>
            {busy ? "Saving..." : "Save placeholder budget"}
          </button>
        </div>
        {result?.ok && (
          <div style={{ color: "var(--fbo-success)" }}>
            Saved: <b>{result.movie.title}</b> — ${(result.budget / 1e6).toFixed(1)}M *(est.)*
          </div>
        )}
        {result?.error && <div style={{ color: "var(--fbo-danger)" }}>{result.error}</div>}
      </form>
    </section>
  );
}

function ManualDailyPanel() {
  const [tmdbId, setTmdbId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rev, setRev] = useState("");
  const [msg, setMsg] = useState("");

  async function submit(e) {
    e.preventDefault();
    setMsg("");
    const r = await apiAdminAddDaily({
      tmdbId: Number(tmdbId),
      date,
      domesticRevenue: Number(rev),
    });
    setMsg(r.ok ? "Saved." : (r.data?.error || "Error"));
    if (r.ok) { setRev(""); }
  }
  return (
    <section style={card}>
      <h3>Manual daily revenue</h3>
      <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="TMDB id" value={tmdbId} onChange={(e) => setTmdbId(e.target.value)} style={{ width: "min(110px, 100%)" }} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: "1 1 130px" }} />
        <input placeholder="Cumulative $" value={rev} onChange={(e) => setRev(e.target.value)} style={{ flex: "1 1 130px" }} />
        <button type="submit">Save</button>
        {msg && <span style={{ color: "#666" }}>{msg}</span>}
      </form>
    </section>
  );
}

function nextFriday() {
  const now = new Date();
  const daysUntilFriday = ((5 - now.getUTCDay() + 7) % 7) || 7;
  const d = new Date(now);
  d.setUTCDate(now.getUTCDate() + daysUntilFriday);
  return d.toISOString().slice(0, 10);
}

function WeekendPanel() {
  const [data, setData] = useState(null);
  const [version, setVersion] = useState(0);
  const [announcing, setAnnouncing] = useState(false);
  const [announceMsg, setAnnounceMsg] = useState(null);
  const [lastCalling, setLastCalling] = useState(false);
  const [lastCallMsg, setLastCallMsg] = useState(null);
  const [scoreInputs, setScoreInputs] = useState({});
  const [scoreBusy, setScoreBusy] = useState({});
  const [scoreResults, setScoreResults] = useState({});
  const [scoreNotify, setScoreNotify] = useState({}); // per-movie "post to Discord" toggle
  const [editingPick, setEditingPick] = useState(null); // { id, estimate (string) }
  const [addingPick, setAddingPick] = useState(null);   // tmdb_id being added to
  const [addPickForm, setAddPickForm] = useState({ discord_user_id: "", estimate: "" });
  const [reviewDate, setReviewDate] = useState(""); // when set, loads a past weekend for audit/re-score

  // Lineup config state — default to next upcoming Friday so the form is
  // never pre-filled with a stale past date.
  const [configDate, setConfigDate] = useState(() => nextFriday());
  const [movieQuery, setMovieQuery] = useState("");
  const [catalog, setCatalog] = useState(null);
  const [lineupIds, setLineupIds] = useState([]);
  const [lineupBusy, setLineupBusy] = useState(false);
  const [lineupMsg, setLineupMsg] = useState(null);
  const [suggestingLineup, setSuggestingLineup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiAdminWeekendScore(reviewDate || undefined).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setData(r.data);
        if (!reviewDate && r.data.weekend_date) {
          const today = new Date().toISOString().slice(0, 10);
          // Only pull the saved date+lineup into the form if it's a future weekend.
          // Past dates stay in `data` for the scoring section but don't overwrite
          // the "next Friday" default in the configure-lineup form.
          if (r.data.weekend_date > today) {
            setConfigDate(r.data.weekend_date);
            if (r.data.movies) setLineupIds(r.data.movies.map((m) => m.tmdb_id));
          }
        }
      }
    });
    apiGameCatalog({ status: "all", owner: "any" }).then((r) => {
      if (!cancelled && r.ok) setCatalog(r.data.movies);
    });
    return () => { cancelled = true; };
  }, [version, reviewDate]);

  const catalogMatches = useMemo(() => {
    if (!catalog) return [];
    const q = movieQuery.trim().toLowerCase();
    const inLineup = new Set(lineupIds);
    const filtered = catalog.filter((m) => !inLineup.has(m.tmdb_id));
    if (!q) return filtered.slice(0, 40);
    return filtered.filter((m) => m.title.toLowerCase().includes(q)).slice(0, 40);
  }, [catalog, movieQuery, lineupIds]);

  const lineupMovies = useMemo(() => {
    if (!catalog) return lineupIds.map((id) => ({ tmdb_id: id, title: String(id) }));
    const byId = Object.fromEntries(catalog.map((m) => [m.tmdb_id, m]));
    return lineupIds.map((id) => byId[id] || { tmdb_id: id, title: String(id) });
  }, [catalog, lineupIds]);

  async function saveLineup() {
    if (!configDate || !lineupIds.length) return;
    setLineupBusy(true);
    setLineupMsg(null);
    const r = await apiAdminSetWeekendMovies(configDate, lineupIds);
    setLineupBusy(false);
    setLineupMsg(r.ok ? { ok: true, text: `Saved ${lineupIds.length} movies for ${configDate}` } : { error: r.data?.error || "Failed" });
    if (r.ok) {
      // Refresh the scoring/picks section for this specific date without triggering
      // the useEffect, which would reset configDate and lineupIds to the active weekend.
      apiAdminWeekendScore(configDate).then((res) => { if (res.ok) setData(res.data); });
    }
  }

  async function suggestLineup() {
    setSuggestingLineup(true);
    setLineupMsg(null);
    // Only pass configDate if it's a future date — past/stale dates are treated
    // as "no preference" and the backend will default to next Friday.
    const today = new Date().toISOString().slice(0, 10);
    const dateToUse = configDate && configDate > today ? configDate : undefined;
    const r = await apiAdminSuggestLineup(dateToUse);
    setSuggestingLineup(false);
    if (!r.ok) { setLineupMsg({ error: r.data?.error || "Failed to suggest lineup" }); return; }
    const { weekend_date, movies: suggested } = r.data;
    if (!suggested.length) {
      setLineupMsg({ error: `No tracked movies found opening around ${weekend_date}` });
      return;
    }
    setConfigDate(weekend_date);
    setLineupIds(suggested.map((m) => m.tmdb_id));
    setLineupMsg({ ok: true, text: `Suggested ${suggested.length} movie${suggested.length !== 1 ? "s" : ""} for ${weekend_date} — review and save` });
  }

  async function announce() {
    setAnnouncing(true);
    setAnnounceMsg(null);
    const r = await apiAdminPostWeekendAnnouncement();
    setAnnouncing(false);
    setAnnounceMsg(r.ok ? { ok: true, text: "Posted to #movie-chat" } : { error: r.data?.error || "Failed" });
  }

  async function lastCall() {
    setLastCalling(true);
    setLastCallMsg(null);
    const r = await apiAdminPostLastCall();
    setLastCalling(false);
    setLastCallMsg(r.ok ? { ok: true, text: "Last-call posted to #movie-chat" } : { error: r.data?.error || "Failed" });
  }

  async function savePick() {
    if (!editingPick) return;
    const est = Number(editingPick.estimate); // integer millions, e.g. 45 = $45M
    if (!est || est <= 0) return;
    const r = await apiAdminUpdatePick(editingPick.id, est);
    if (r.ok) { setEditingPick(null); setVersion((v) => v + 1); }
    else alert(r.data?.error || "Failed to update");
  }

  async function deletePick(id) {
    if (!window.confirm("Delete this pick?")) return;
    const r = await apiAdminDeletePick(id);
    if (r.ok) setVersion((v) => v + 1);
    else alert(r.data?.error || "Failed to delete");
  }

  async function createPick(tmdbId) {
    const est = Number(addPickForm.estimate); // integer millions, e.g. 45 = $45M
    if (!addPickForm.discord_user_id || !est || est <= 0) return;
    const r = await apiAdminCreatePick({
      discord_user_id: addPickForm.discord_user_id,
      tmdb_id: tmdbId,
      weekend_date: data.weekend_date,
      estimate: est,
    });
    if (r.ok) { setAddingPick(null); setAddPickForm({ discord_user_id: "", estimate: "" }); setVersion((v) => v + 1); }
    else alert(r.data?.error || "Failed to create");
  }

  async function scoreMovie(tmdbId) {
    const raw = scoreInputs[tmdbId] || "";
    // Input is in $M (e.g. "33" = $33M). Multiply by 1M for storage.
    const millions = Number(raw.replace(/[$,M\s]/g, ""));
    if (!millions || millions <= 0) return;
    const gross = Math.round(millions) * 1_000_000;
    const notify = scoreNotify[tmdbId] !== false; // default true
    setScoreBusy((b) => ({ ...b, [tmdbId]: true }));
    const r = await apiAdminScoreMovie(data.weekend_date, tmdbId, gross, notify);
    setScoreBusy((b) => ({ ...b, [tmdbId]: false }));
    if (r.ok) {
      setScoreResults((s) => ({ ...s, [tmdbId]: { ok: true, data: r.data } }));
      setVersion((v) => v + 1);
    } else {
      setScoreResults((s) => ({ ...s, [tmdbId]: { error: r.data?.error || "Failed" } }));
    }
  }

  const movies = data?.movies || [];
  const picks = data?.picks || {};
  const abstentions = data?.abstentions || {};
  // All in-league users with Discord IDs — used for the "add pick" dropdown.
  const leagueUsers = useMemo(() => {
    if (!data) return [];
    const seen = new Set();
    const all = [];
    for (const abs of Object.values(data.abstentions || {})) {
      for (const u of abs) {
        if (!seen.has(u.discord_user_id)) { seen.add(u.discord_user_id); all.push(u); }
      }
    }
    for (const ps of Object.values(data.picks || {})) {
      for (const p of ps) {
        if (!seen.has(p.discord_user_id) && p.fbo_username) {
          seen.add(p.discord_user_id);
          all.push({ discord_user_id: p.discord_user_id, username: p.fbo_username });
        }
      }
    }
    return all.sort((a, b) => a.username.localeCompare(b.username));
  }, [data]);

  return (
    <section style={card}>
      <h3>Weekend Predictions</h3>

      {/* Lineup configuration */}
      <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #eee" }}>
        <h4 style={{ marginTop: 0, marginBottom: 8 }}>Configure lineup</h4>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <label>
            Weekend date{" "}
            <input
              type="date"
              value={configDate}
              onChange={(e) => setConfigDate(e.target.value)}
              style={{ marginLeft: 4 }}
            />
          </label>
          <button onClick={suggestLineup} disabled={suggestingLineup} title="Auto-fill lineup from catalog movies releasing that Friday">
            {suggestingLineup ? "Finding..." : "Suggest lineup"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 300px" }}>
            <input
              placeholder="Search catalog to add a movie..."
              value={movieQuery}
              onChange={(e) => setMovieQuery(e.target.value)}
              style={{ width: "100%", marginBottom: 4 }}
            />
            {catalogMatches.length > 0 && (
              <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid var(--fbo-border)", borderRadius: 4 }}>
                {catalogMatches.map((m) => (
                  <div
                    key={m.tmdb_id}
                    onClick={() => { setLineupIds((ids) => [...ids, m.tmdb_id]); setMovieQuery(""); }}
                    style={{ padding: "5px 8px", cursor: "pointer", borderBottom: "1px solid var(--fbo-border)", fontSize: 13 }}
                  >
                    <b>{m.title}</b> <span style={{ color: "var(--fbo-text-muted)" }}>{m.release_date}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>Current lineup:</div>
            {lineupMovies.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--fbo-text-muted)" }}>No movies added.</div>
            ) : lineupMovies.map((m) => (
              <div key={m.tmdb_id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, fontSize: 13 }}>
                <span style={{ flex: 1 }}>{m.title || m.tmdb_id}</span>
                <button
                  style={{ fontSize: 11, padding: "1px 6px" }}
                  onClick={() => setLineupIds((ids) => ids.filter((id) => id !== m.tmdb_id))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <button onClick={saveLineup} disabled={lineupBusy || !configDate || !lineupIds.length}>
            {lineupBusy ? "Saving..." : "Save lineup"}
          </button>
          <button onClick={announce} disabled={announcing}>
            {announcing ? "Posting..." : "Post announcement to #movie-chat"}
          </button>
          <button onClick={lastCall} disabled={lastCalling}>
            {lastCalling ? "Posting..." : "Post last-call to #movie-chat"}
          </button>
          {lineupMsg?.ok && <span style={{ color: "var(--fbo-success)", fontSize: 13 }}>{lineupMsg.text}</span>}
          {lineupMsg?.error && <span style={{ color: "var(--fbo-danger)", fontSize: 13 }}>{lineupMsg.error}</span>}
          {announceMsg?.ok && <span style={{ color: "var(--fbo-success)", fontSize: 13 }}>{announceMsg.text}</span>}
          {announceMsg?.error && <span style={{ color: "var(--fbo-danger)", fontSize: 13 }}>{announceMsg.error}</span>}
          {lastCallMsg?.ok && <span style={{ color: "var(--fbo-success)", fontSize: 13 }}>{lastCallMsg.text}</span>}
          {lastCallMsg?.error && <span style={{ color: "var(--fbo-danger)", fontSize: 13 }}>{lastCallMsg.error}</span>}
        </div>
      </div>

      {/* Audit past weekends — date picker to load any scored weekend for review/re-score */}
      <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #eee" }}>
        <h4 style={{ marginTop: 0, marginBottom: 8 }}>Picks &amp; Scoring</h4>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <label>
            Review past weekend{" "}
            <input
              type="date"
              value={reviewDate}
              onChange={(e) => { setReviewDate(e.target.value); setScoreInputs({}); setScoreResults({}); }}
              style={{ marginLeft: 4 }}
            />
          </label>
          {reviewDate && (
            <button style={{ fontSize: 12 }} onClick={() => { setReviewDate(""); setScoreInputs({}); setScoreResults({}); }}>
              ✕ Back to active
            </button>
          )}
          {reviewDate && data?.weekend_date && (
            <span style={{ color: "var(--fbo-text-muted)" }}>Showing {data.weekend_date}</span>
          )}
        </div>
      </div>

      {/* Picks & scoring per movie */}
      {!data ? (
        <div>Loading...</div>
      ) : movies.length === 0 ? (
        <div style={{ color: "var(--fbo-text-muted)", fontSize: 13 }}>No movies in the active weekend lineup.</div>
      ) : movies.map((m) => {
        const moviePicks = picks[m.tmdb_id] || [];
        const movieAbstentions = abstentions[m.tmdb_id] || [];
        const scored = scoreResults[m.tmdb_id];
        const isScored = m.actual_gross != null;

        return (
          <div key={m.tmdb_id} style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #f0f0f0" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
              <strong>{m.title}</strong>
              <span style={{ fontSize: 12, color: "var(--fbo-text-muted)" }}>owned by {m.owner}</span>
              {isScored && (
                <span style={{ fontSize: 12, color: "var(--fbo-success)" }}>
                  ✓ Scored — actual: ${Math.round(m.actual_gross / 1e6)}M
                </span>
              )}
            </div>

            <div className="fbo-scroll-x" style={{ marginBottom: 8 }}>
              <table style={{ ...tbl, fontSize: 13 }}>
                <thead>
                  <tr style={thRow}>
                    <th style={th}>Player</th>
                    <th style={thRight}>Estimate</th>
                    {isScored && <th style={thRight}>Off by</th>}
                    {isScored && <th style={thRight}>Pts</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {moviePicks.map((p) => {
                    const isEditing = editingPick?.id === p.id;
                    return (
                      <tr key={p.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                        <td style={td}>{p.fbo_username || p.discord_username}</td>
                        <td style={tdRight}>
                          {isEditing ? (
                            <span style={{ display: "flex", gap: 4, justifyContent: "flex-end", alignItems: "center" }}>
                              <input
                                type="number"
                                min={1}
                                value={editingPick.estimate}
                                onChange={(e) => setEditingPick((ep) => ({ ...ep, estimate: e.target.value }))}
                                style={{ width: 60, textAlign: "right" }}
                                autoFocus
                              />
                              <span style={{ fontSize: 11 }}>M</span>
                            </span>
                          ) : (
                            // Handle both storage formats: integer millions (< 1M) and raw dollars
                            p.estimate < 1_000_000 ? `$${p.estimate}M` : `$${Math.round(p.estimate / 1e6)}M`
                          )}
                        </td>
                        {isScored && <td style={tdRight}>${Math.round(Math.abs((p.estimate < 1_000_000 ? p.estimate * 1_000_000 : p.estimate) - m.actual_gross) / 1e6)}M</td>}
                        {isScored && <td style={tdRight}>{p.points_awarded ?? "—"}</td>}
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {isEditing ? (
                            <>
                              <button style={{ fontSize: 11 }} onClick={savePick}>Save</button>{" "}
                              <button style={{ fontSize: 11 }} onClick={() => setEditingPick(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button style={{ fontSize: 11 }} onClick={() => setEditingPick({ id: p.id, estimate: String(p.estimate < 1_000_000 ? p.estimate : Math.round(p.estimate / 1e6)) })}>Edit</button>{" "}
                              <button style={{ fontSize: 11, color: "var(--fbo-danger)" }} onClick={() => deletePick(p.id)}>Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {movieAbstentions.map((u) => (
                    <tr key={u.discord_user_id} style={{ borderTop: "1px solid #f0f0f0", color: "var(--fbo-text-muted)" }}>
                      <td style={td}>{u.username} <em>(no bet)</em></td>
                      <td style={tdRight}>—</td>
                      {isScored && <td style={tdRight}>—</td>}
                      {isScored && <td style={tdRight}>0</td>}
                      <td></td>
                    </tr>
                  ))}
                  {moviePicks.length === 0 && movieAbstentions.length === 0 && (
                    <tr>
                      <td colSpan={isScored ? 5 : 3} style={{ ...td, color: "var(--fbo-text-muted)" }}>No picks yet.</td>
                    </tr>
                  )}
                  {/* Add pick row */}
                  {addingPick === m.tmdb_id ? (
                    <tr style={{ borderTop: "1px solid #f0f0f0", background: "#fafafa" }}>
                      <td style={td}>
                        <select
                          value={addPickForm.discord_user_id}
                          onChange={(e) => setAddPickForm((f) => ({ ...f, discord_user_id: e.target.value }))}
                          style={{ fontSize: 12 }}
                        >
                          <option value="">— player —</option>
                          {(leagueUsers).map((u) => (
                            <option key={u.discord_user_id} value={u.discord_user_id}>{u.username}</option>
                          ))}
                        </select>
                      </td>
                      <td style={tdRight}>
                        <span style={{ display: "flex", gap: 4, justifyContent: "flex-end", alignItems: "center" }}>
                          <input
                            type="number"
                            min={1}
                            placeholder="45"
                            value={addPickForm.estimate}
                            onChange={(e) => setAddPickForm((f) => ({ ...f, estimate: e.target.value }))}
                            style={{ width: 60, textAlign: "right" }}
                          />
                          <span style={{ fontSize: 11 }}>M</span>
                        </span>
                      </td>
                      {isScored && <td></td>}
                      {isScored && <td></td>}
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <button style={{ fontSize: 11 }} onClick={() => createPick(m.tmdb_id)}>Add</button>{" "}
                        <button style={{ fontSize: 11 }} onClick={() => setAddingPick(null)}>Cancel</button>
                      </td>
                    </tr>
                  ) : (
                    <tr style={{ borderTop: "1px solid #f0f0f0" }}>
                      <td colSpan={isScored ? 5 : 3} style={td}>
                        <button style={{ fontSize: 11 }} onClick={() => { setAddingPick(m.tmdb_id); setAddPickForm({ discord_user_id: "", estimate: "" }); }}>
                          + Add pick
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 13 }}>
                Actual gross{" "}
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 33"
                  value={scoreInputs[m.tmdb_id] ?? (m.actual_gross ? String(Math.round(m.actual_gross / 1_000_000)) : "")}
                  onChange={(e) => setScoreInputs((s) => ({ ...s, [m.tmdb_id]: e.target.value }))}
                  style={{ width: 80, marginLeft: 4, textAlign: "right" }}
                />
                <span style={{ fontSize: 12, marginLeft: 2 }}>$M</span>
              </label>
              <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="checkbox"
                  checked={scoreNotify[m.tmdb_id] !== false}
                  onChange={(e) => setScoreNotify((n) => ({ ...n, [m.tmdb_id]: e.target.checked }))}
                />
                Post to #game-feed
              </label>
              <button
                onClick={() => scoreMovie(m.tmdb_id)}
                disabled={scoreBusy[m.tmdb_id] || !scoreInputs[m.tmdb_id]}
              >
                {scoreBusy[m.tmdb_id] ? "Scoring..." : isScored ? "Re-score" : "Score"}
              </button>
              {scored?.ok && <span style={{ color: "var(--fbo-success)", fontSize: 13 }}>{scoreNotify[m.tmdb_id] !== false ? "Scored & posted!" : "Scored (silent)."}</span>}
              {scored?.error && <span style={{ color: "var(--fbo-danger)", fontSize: 13 }}>{scored.error}</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ── Prediction Points Log ────────────────────────────────────────────────────

function fmtEst(v) {
  return v < 1_000_000 ? `$${v}M` : `$${Math.round(v / 1_000_000)}M`;
}

function PredictionPointsLog() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    apiBettingHistory().then((r) => { if (r.ok) setData(r.data); });
  }, [open, data]);

  // Build per-player totals from all scored weekends.
  const playerTotals = useMemo(() => {
    if (!data) return [];
    const totals = {};
    for (const w of data.weekends ?? []) {
      for (const m of w.movies ?? []) {
        for (const p of m.picks ?? []) {
          if (p.points_awarded == null) continue;
          if (!totals[p.discord_username]) totals[p.discord_username] = 0;
          totals[p.discord_username] += p.points_awarded;
        }
      }
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <section style={card}>
      <h3 style={{ marginTop: 0, cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        Prediction Points Log {open ? "▲" : "▼"}
      </h3>
      {open && (
        <>
          {!data ? (
            <div>Loading...</div>
          ) : (
            <>
              {/* Leaderboard */}
              {playerTotals.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ marginTop: 0 }}>Total Prediction Points</h4>
                  <table style={{ ...tbl, fontSize: 13 }}>
                    <thead>
                      <tr style={thRow}>
                        <th style={th}>#</th>
                        <th style={th}>Player</th>
                        <th style={thRight}>Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {playerTotals.map(([name, pts], i) => (
                        <tr key={name} style={{ borderTop: "1px solid #f0f0f0" }}>
                          <td style={{ ...td, color: "var(--fbo-text-muted)" }}>{i + 1}</td>
                          <td style={td}>{name}</td>
                          <td style={tdRight}><strong>{pts}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Per-weekend detail */}
              {(data.weekends ?? []).map((w) => (
                <div key={w.weekend_date} style={{ marginBottom: 24 }}>
                  <h4 style={{ marginTop: 0 }}>Opening Weekend — {w.weekend_date}</h4>
                  {w.movies.map((m) => (
                    <div key={m.tmdb_id} style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
                        {m.title}
                        {m.actual_gross != null && (
                          <span style={{ fontWeight: 400, color: "var(--fbo-text-muted)", marginLeft: 8 }}>
                            Actual: ${Math.round(m.actual_gross / 1e6)}M
                          </span>
                        )}
                      </div>
                      {m.picks.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--fbo-text-muted)" }}>No picks.</div>
                      ) : (
                        <table style={{ ...tbl, fontSize: 12 }}>
                          <thead>
                            <tr style={thRow}>
                              <th style={th}>Player</th>
                              <th style={thRight}>Bet</th>
                              {m.actual_gross != null && <th style={thRight}>Off by</th>}
                              <th style={thRight}>Pts</th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.picks.map((p, i) => {
                              const rawEst = p.estimate < 1_000_000 ? p.estimate * 1_000_000 : p.estimate;
                              const offBy = m.actual_gross != null
                                ? Math.round(Math.abs(rawEst - m.actual_gross) / 1e6)
                                : null;
                              return (
                                <tr key={i} style={{ borderTop: "1px solid #f0f0f0" }}>
                                  <td style={td}>{p.discord_username}</td>
                                  <td style={tdRight}>{fmtEst(p.estimate)}</td>
                                  {m.actual_gross != null && (
                                    <td style={{ ...tdRight, color: offBy === 0 ? "var(--fbo-success)" : undefined }}>
                                      ${offBy}M
                                    </td>
                                  )}
                                  <td style={{ ...tdRight, fontWeight: p.points_awarded > 0 ? 600 : 400 }}>
                                    {p.points_awarded ?? "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {(data.weekends ?? []).length === 0 && (
                <div style={{ color: "var(--fbo-text-muted)", fontSize: 13 }}>No scored weekends yet.</div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

const card = { background: "white", border: "1px solid #eee", borderRadius: 8, padding: 16, marginBottom: 16 };
const tbl = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
const thRow = { textAlign: "left", color: "#666", background: "#fafafa" };
const th = { padding: 8 };
const thRight = { ...th, textAlign: "right" };
const td = { padding: 8 };
const tdRight = { ...td, textAlign: "right" };
