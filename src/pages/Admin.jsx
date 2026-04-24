import { useCallback, useEffect, useState } from "react";
import {
  apiAdminUsers, apiAdminGrantPoints, apiAdminSetAdmin,
  apiAdminRefreshMovies, apiAdminRefreshDailies, apiAdminBackfillDailies, apiAdminAddDaily,
  apiAdminBackfillBudgets, apiAdminImportTsv,
  apiAdminUpdateProfile, apiAdminResetPassword, apiAdminSetInLeague,
  apiAdminPostStandingsToDiscord,
  apiAuctions, apiAdminEditAuction, apiAdminDeleteAuction,
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
      <ImportPanel />
      <UsersPanel />
      <AuctionsPanel />
      <ManualDailyPanel />
    </div>
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
                <td style={td}>
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
        <table style={tbl}>
          <thead>
            <tr style={thRow}>
              <th style={th}>Movie</th>
              <th style={th}>Status</th>
              <th style={thRight}>Bid</th>
              <th style={th}>Bidder</th>
              <th style={th}>Ends</th>
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
                <td style={td}>{a.ends_at}</td>
                <td style={td}>
                  <button onClick={() => edit(a)}>Edit</button>{" "}
                  <button onClick={() => del(a)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
        <input placeholder="TMDB id" value={tmdbId} onChange={(e) => setTmdbId(e.target.value)} style={{ width: 110 }} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input placeholder="Cumulative $" value={rev} onChange={(e) => setRev(e.target.value)} style={{ width: 160 }} />
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
