import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiAuction, apiBid, apiSettleAuction } from "../api";
import { timeRemaining, fullCurrency } from "../format";
import { useUser } from "../useUser";

export default function AuctionDetail() {
  const { id } = useParams();
  const { user, refresh } = useUser();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiAuction(id).then((r) => {
      if (cancelled) return;
      if (!r.ok) setErr(r.data?.error || "Failed to load");
      else setData(r.data);
    });
    return () => { cancelled = true; };
  }, [id, version]);

  useEffect(() => {
    const poll = setInterval(() => setVersion((v) => v + 1), 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [id]);

  async function submitBid(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const r = await apiBid(id, Number(amount));
    setBusy(false);
    if (!r.ok) return setErr(r.data?.error || "Bid failed");
    setAmount("");
    refresh();
    reload();
  }

  async function settleNow() {
    const r = await apiSettleAuction(id);
    if (r.ok) { refresh(); reload(); }
    else setErr(r.data?.error || "Settle failed");
  }

  if (!data) return <div>Loading auction...</div>;
  const a = data.auction;
  const ended = new Date(a.ends_at).getTime() <= now;
  const isMyBid = a.current_bidder_id === user?.id;
  const minBid = a.current_bid + 1;

  return (
    <div style={{ maxWidth: 720 }}>
      <Link to="/auctions">← All auctions</Link>
      <h1 style={{ marginTop: 8 }}>{a.title}</h1>
      <div style={{ display: "flex", gap: 16 }}>
        {a.poster_url && <img src={a.poster_url} alt="" style={{ width: 160, borderRadius: 6 }} />}
        <div>
          <div>Releases <b>{a.release_date}</b></div>
          <div>Budget: {fullCurrency(a.budget)}</div>
          <div style={{ marginTop: 8 }}>
            Current bid: <b>{a.current_bid}</b> pts by <b>{a.current_bidder_username}</b>
          </div>
          <div>Status: {a.status}</div>
          <div>Ends: {ended ? "ended" : timeRemaining(a.ends_at)} ({a.ends_at})</div>
        </div>
      </div>

      {a.status === "open" && !ended && (
        <form onSubmit={submitBid} style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="number"
            min={minBid}
            placeholder={`Min ${minBid}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ width: 120 }}
            disabled={isMyBid}
          />
          <button type="submit" disabled={busy || isMyBid}>
            {isMyBid ? "You're the top bidder" : busy ? "Bidding..." : "Place bid"}
          </button>
          <span style={{ color: "#666" }}>You have {user?.points_remaining ?? "—"} pts</span>
        </form>
      )}

      {a.status === "open" && ended && (
        <div style={{ marginTop: 16 }}>
          <button onClick={settleNow}>Settle now</button>
          <span style={{ color: "#666", marginLeft: 8 }}>Cron runs every minute.</span>
        </div>
      )}

      {err && <div style={{ color: "crimson", marginTop: 8 }}>{err}</div>}

      <h3 style={{ marginTop: 24 }}>Bid history</h3>
      <table style={{ width: "100%", background: "white", border: "1px solid #eee", borderRadius: 8, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#666", background: "#fafafa" }}>
            <th style={{ padding: 8 }}>User</th>
            <th style={{ textAlign: "right" }}>Amount</th>
            <th style={{ padding: 8 }}>Time</th>
          </tr>
        </thead>
        <tbody>
          {data.bids.map((b) => (
            <tr key={b.id} style={{ borderTop: "1px solid #f0f0f0" }}>
              <td style={{ padding: 8 }}>{b.username}</td>
              <td style={{ textAlign: "right" }}>{b.amount}</td>
              <td style={{ padding: 8 }}>{new Date(b.bid_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
