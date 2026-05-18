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
  apiAuctions, apiAdminEditAuction, apiAdminDeleteAuction,
  apiGameCatalog,
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
    const r = await apiAdminUpdateProfile(u.id, { username, email });
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

  async function edit(a) {
    const raw = window.prompt("JSON patch (status/current_bid/current_bidder_id/ends_at)", JSON.stringify({}));
    if (!raw) return;
    let patch;
    try { patch = JSON.parse(raw); } catch { return alert("invalid JSON"); }
    const r = await apiAdminEditAuction(a.id, patch);
    if (!r.ok) return alert(r.data?.error);
    reload();
  }
  async function del(a) {
    if (!window.confirm(`Delete auction ${a.id}?`)) return;
    const r = await apiAdminDeleteAuction(a.id);
    if (!r.ok) return alert(r.data?.error);
    reload();
  }

  return (
    <section style={card}>
      <h3>Auctions</h3>
      {!auctions ? <div>Loading...</div> : (
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
                <tr key={a.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <td style={td}>{a.title}</td>
                  <td style={td}>{a.status}</td>
                  <td style={tdRight}>{a.current_bid}</td>
                  <td style={td}>{a.current_bidder_username}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{a.ends_at}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button onClick={() => edit(a)}>Edit</button>{" "}
                    <button onClick={() => del(a)}>Delete</button>
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

const card = { background: "white", border: "1px solid #eee", borderRadius: 8, padding: 16, marginBottom: 16 };
const tbl = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
const thRow = { textAlign: "left", color: "#666", background: "#fafafa" };
const th = { padding: 8 };
const thRight = { ...th, textAlign: "right" };
const td = { padding: 8 };
const tdRight = { ...td, textAlign: "right" };
