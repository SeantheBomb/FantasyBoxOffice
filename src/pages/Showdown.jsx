import { Fragment, useEffect, useState } from "react";
import { apiShowdownBet } from "../api";
import "../Showdown.css";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CONFETTI = Array.from({ length: 48 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 53) % 30) / 25,
  duration: 2 + ((i * 29) % 10) / 10,
  rotate: (i * 47) % 360,
  color: ["#f5d27a", "#ef4444", "#10b981", "#3b82f6", "#f2ead8"][i % 5],
}));

function fmtDate(iso) {
  const [, m, d] = iso.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${Number(d)}`;
}

function fmtDollars(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtMillions(n) {
  return n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`;
}

const pts = (n) => `${n} pt${n === 1 ? "" : "s"}`;
const pad = (n) => String(n).padStart(2, "0");

function fmtCountdown(ms) {
  const s = Math.max(Math.floor(ms / 1000), 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d ? `${d}d ` : ""}${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

function useNow(ticking) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  return now;
}

// 0 = curtain closed, 1 = bars race, 2 = winner stamped, 3 = your result.
function useReveal(animate) {
  const [phase, setPhase] = useState(animate ? 0 : 3);
  useEffect(() => {
    if (!animate) return;
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1800),
      setTimeout(() => setPhase(3), 2400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [animate]);
  return phase;
}

function useCountUp(target, run, duration = 1300) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min((t - start) / duration, 1);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, duration]);
  return run ? value : target;
}

function GrossNum({ value, animate }) {
  return <>{fmtDollars(useCountUp(value, animate))}</>;
}

function Confetti() {
  return (
    <div className="sd-confetti" aria-hidden="true">
      {CONFETTI.map((c, i) => (
        <i
          key={i}
          style={{
            left: `${c.left}%`,
            background: c.color,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.duration}s`,
            transform: `rotate(${c.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

function Tile({ movie, sd, phase, totalPoints, maxGross, selected, allIn, mine, lockedNow, pickable, onPick }) {
  const settled = sd.status === "settled";
  const isWinner = settled && phase >= 2 && movie.tmdb_id === sd.winner_tmdb_id;
  const showGross = movie.gross != null && (sd.live || ((settled || sd.status === "push") && phase >= 1));
  const leader = sd.live && movie.gross != null && movie.gross === maxGross;
  const backers = sd.bets.filter((b) => b.tmdb_id === movie.tmdb_id && b.outcome !== "refunded");

  const cls = [
    "sd-tile",
    pickable && "sd-tile--pickable",
    selected && (allIn ? "sd-tile--allin" : "sd-tile--selected"),
    mine && "sd-tile--mine",
    isWinner && "sd-tile--winner",
    settled && phase >= 2 && !isWinner && "sd-tile--dim",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={cls}
      role={pickable ? "button" : undefined}
      tabIndex={pickable ? 0 : undefined}
      aria-pressed={pickable ? selected : undefined}
      onClick={pickable ? onPick : undefined}
      onKeyDown={pickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } } : undefined}
    >
      <div className="sd-poster">
        {movie.poster_url
          ? <img src={movie.poster_url} alt={movie.title} />
          : <div className="sd-poster-empty">🎬</div>}
        {mine && <div className="sd-ribbon">Your pick · {mine.stake}</div>}
        {!mine && selected && <div className={`sd-ribbon ${allIn ? "sd-ribbon--allin" : ""}`}>{allIn ? "All in" : "Your pick"}</div>}
        {isWinner && <div className="sd-stamp"><span>WINNER</span></div>}
        {lockedNow && !isWinner && <div className="sd-stamp sd-stamp--locked"><span>LOCKED IN</span></div>}
      </div>
      <div className="sd-info">
        <div className="sd-name">{leader && "🔥 "}{movie.title}</div>
        <div className="sd-meta">
          {movie.backers} backer{movie.backers === 1 ? "" : "s"} · {pts(movie.points)}
        </div>
        <div className="sd-share" title="Share of points riding on this movie">
          <i style={{ width: `${totalPoints ? (movie.points / totalPoints) * 100 : 0}%` }} />
        </div>
        {showGross && (
          <div className={`sd-gross ${leader ? "sd-gross--lead" : ""}`}>
            <div className="sd-gross-label">{sd.live ? "Latest BOM" : "Opening weekend"}</div>
            <div className="sd-gross-bar"><i style={{ width: `${(movie.gross / maxGross) * 100}%` }} /></div>
            <div className="sd-gross-num"><GrossNum value={movie.gross} animate={!sd.live && phase === 1} /></div>
          </div>
        )}
        {backers.length > 0 && (
          <div className="sd-chips">
            {backers.map((b) => (
              <span
                key={b.id}
                className={[
                  "sd-chip",
                  b.is_me && "sd-chip--me",
                  phase >= 2 && b.outcome === "won" && "sd-chip--won",
                  phase >= 2 && b.outcome === "lost" && "sd-chip--lost",
                ].filter(Boolean).join(" ")}
              >
                {b.username} · {b.stake}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StakePanel({ me, stake, setStake, movie, onGo }) {
  const allIn = stake === me.available;
  const half = Math.max(Math.floor(me.available / 2), 1);
  const quick = [5, 10, 25].filter((v) => v < me.available);
  const loseBalance = me.balance - stake;

  return (
    <div className={`sd-stake ${allIn ? "sd-stake--allin" : ""}`}>
      <div className="sd-stake-row">
        <div className="sd-stake-amount">{stake}<span style={{ fontSize: 14, marginLeft: 4 }}>pts</span></div>
        <input
          className="sd-range"
          type="range"
          min={1}
          max={me.available}
          value={stake}
          onChange={(e) => setStake(Number(e.target.value))}
          aria-label="Stake"
        />
        <input
          className="sd-num"
          type="number"
          min={1}
          max={me.available}
          value={stake}
          onChange={(e) => setStake(Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), me.available))}
          aria-label="Stake amount"
        />
      </div>
      <div className="sd-quick">
        {quick.map((v) => <button key={v} type="button" onClick={() => setStake(v)}>{v}</button>)}
        {half < me.available && !quick.includes(half) && <button type="button" onClick={() => setStake(half)}>Half</button>}
        <button type="button" className="sd-allin-btn" onClick={() => setStake(me.available)}>🚨 ALL IN</button>
      </div>
      <div className="sd-odds">
        <div className="win">If <b style={{ display: "inline", fontSize: 13, color: "inherit" }}>{movie.title}</b> wins<b>+{stake} → {pts(me.balance + stake)}</b></div>
        <div className="lose">If it doesn&apos;t<b>−{stake} → {pts(loseBalance)}{loseBalance === 0 ? " 💀" : ""}</b></div>
      </div>
      {me.held > 0 && (
        <div className="sd-note">{pts(me.held)} held for your leading auction bids can&apos;t be staked.</div>
      )}
      <button type="button" className={`sd-go ${allIn ? "sd-go--allin" : ""}`} onClick={onGo}>
        {allIn ? `🚨 Go all in — ${pts(stake)}` : `🔒 Lock in ${pts(stake)}`}
      </button>
    </div>
  );
}

function ConfirmModal({ movie, stake, allIn, busy, error, onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="sd-modal-bg" onClick={busy ? undefined : onCancel}>
      <div className={`sd-modal ${allIn ? "sd-modal--allin" : ""}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {movie.poster_url && <img src={movie.poster_url} alt="" />}
        <h3>{allIn ? "ALL IN?" : "Lock it in?"}</h3>
        <p><b style={{ color: "var(--fbo-text)" }}>{pts(stake)}</b> on <b style={{ color: "var(--fbo-text)" }}>{movie.title}</b> to win the weekend.</p>
        <p>Showdown bets are final — no take-backs.</p>
        {error && <div className="sd-error">{error}</div>}
        <div className="sd-modal-actions">
          <button type="button" className={`sd-go ${allIn ? "sd-go--allin" : ""}`} disabled={busy} onClick={onConfirm} autoFocus>
            {busy ? "Locking…" : allIn ? "🚨 Send it" : "🔒 Lock it in"}
          </button>
          <button type="button" className="sd-back" disabled={busy} onClick={onCancel}>Back</button>
        </div>
      </div>
    </div>
  );
}

function ShowdownBody({ showdown: sd, me, hasAuth, compact, onBetPlaced, onReplay }) {
  const resolved = sd.status === "settled" || sd.status === "push";
  const phase = useReveal(resolved && !compact);
  const now = useNow(sd.is_open);
  const msLeft = Date.parse(sd.closes_at) - now;
  const open = sd.is_open && msLeft > 0;

  const [selected, setSelected] = useState(null);
  const [stake, setStake] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lockedId, setLockedId] = useState(null);

  const myBet = sd.bets.find((b) => b.is_me) ?? null;
  const canBet = open && hasAuth && me?.in_league && !myBet && me.available > 0;
  const allIn = canBet && stake === me.available;
  const selectedMovie = sd.movies.find((m) => m.tmdb_id === selected) ?? null;
  const totalPoints = sd.movies.reduce((s, m) => s + m.points, 0);
  const players = new Set(sd.bets.filter((b) => b.outcome !== "refunded").map((b) => b.username)).size;
  const maxGross = Math.max(...sd.movies.map((m) => m.gross ?? 0), 1);
  const winner = sd.movies.find((m) => m.tmdb_id === sd.winner_tmdb_id) ?? null;
  const ranked = [...sd.movies].sort((a, b) => (b.gross ?? 0) - (a.gross ?? 0));
  const upset = winner && winner.points < Math.max(...sd.movies.filter((m) => m !== winner).map((m) => m.points));
  const duel = sd.movies.length === 2;
  const urgent = open && msLeft < 3600_000;
  const showConfetti = !compact && phase >= 3 && myBet?.outcome === "won";
  const winnings = useCountUp(myBet?.stake ?? 0, !compact && phase >= 3 && myBet?.outcome === "won");

  async function lockIn() {
    setBusy(true);
    setError("");
    const res = await apiShowdownBet(selected, stake);
    setBusy(false);
    if (!res.ok) {
      setError(res.data?.error ?? "Couldn't place that bet");
      return;
    }
    setConfirming(false);
    setLockedId(selected);
    setSelected(null);
    onBetPlaced();
  }

  function pick(id) {
    setSelected((cur) => (cur === id ? null : id));
    setStake((s) => Math.min(Math.max(s, 1), me.available));
  }

  let pill;
  if (open) pill = <span className="sd-pill sd-pill--open">Betting open</span>;
  else if (resolved) pill = <span className="sd-pill sd-pill--done">Final</span>;
  else if (sd.live) pill = <span className="sd-pill sd-pill--live">● Live</span>;
  else pill = <span className="sd-pill sd-pill--closed">Betting closed</span>;

  let sub;
  if (open) sub = "Which movie wins the weekend? Stake points on your pick — double or nothing.";
  else if (sd.status === "settled" && phase >= 2) sub = `🏆 ${winner.title} won the weekend${ranked[1]?.gross != null ? ` by ${fmtMillions(winner.gross - ranked[1].gross)}` : ""}.${upset ? " 🐶 Upset!" : ""}`;
  else if (sd.status === "push" && phase >= 2) sub = "🤝 Dead heat — tied to the dollar. Every stake refunded.";
  else if (resolved) sub = "The envelope, please… 🥁";
  else sub = sd.live ? "🍿 In theaters — here's the race so far. Final results drop Monday." : "🍿 Betting's closed. Results drop Monday.";

  return (
    <section className={`sd ${compact ? "sd--compact" : ""}`}>
      {showConfetti && <Confetti />}
      <div className="sd-head">
        <h2 className="sd-title">⚔️ Showdown · {fmtDate(sd.weekend_date)}</h2>
        {pill}
        {open && <span className={`sd-clock ${urgent ? "sd-clock--urgent" : ""}`}>⏱ {fmtCountdown(msLeft)}</span>}
      </div>
      <p className="sd-sub">
        {sub}
        {players > 0 && <> · <b style={{ color: "var(--fbo-text)" }}>{players}</b> in · <b style={{ color: "var(--fbo-gold)" }}>{pts(totalPoints)}</b> on the line</>}
      </p>

      <div className={`sd-arena ${duel ? "sd-arena--duel" : ""}`}>
        {sd.movies.map((m, i) => (
          <Fragment key={m.tmdb_id}>
            {duel && i === 1 && <div className="sd-vs">VS</div>}
            <Tile
              movie={m}
              sd={sd}
              phase={phase}
              totalPoints={totalPoints}
              maxGross={maxGross}
              selected={selected === m.tmdb_id}
              allIn={allIn}
              mine={myBet?.tmdb_id === m.tmdb_id ? myBet : null}
              lockedNow={lockedId === m.tmdb_id}
              pickable={canBet}
              onPick={() => pick(m.tmdb_id)}
            />
          </Fragment>
        ))}
      </div>

      {canBet && !selectedMovie && <div className="sd-note">👆 Tap the movie you think wins the weekend.</div>}
      {canBet && selectedMovie && (
        <StakePanel me={me} stake={stake} setStake={setStake} movie={selectedMovie} onGo={() => { setError(""); setConfirming(true); }} />
      )}
      {open && !hasAuth && <div className="sd-note"><a href="/login" style={{ color: "var(--fbo-gold)" }}>Sign in</a> to join the showdown.</div>}
      {open && hasAuth && me && !me.in_league && <div className="sd-note">You must be in the league to join the showdown.</div>}
      {open && me?.in_league && !myBet && me.available === 0 && (
        <div className="sd-note">You have no points available to stake{me.held ? ` (${pts(me.held)} are held for your leading auction bids)` : ""}.</div>
      )}
      {myBet?.outcome === "refunded" && !resolved && (
        <div className="sd-note">↩️ Your stake of {pts(myBet.stake)} was refunded.</div>
      )}
      {myBet && !myBet.outcome && !resolved && (
        <div className="sd-note">
          🔒 You&apos;re in: <b style={{ color: "var(--fbo-gold)" }}>{pts(myBet.stake)}</b> on <b style={{ color: "var(--fbo-text)" }}>{sd.movies.find((m) => m.tmdb_id === myBet.tmdb_id)?.title}</b>.
          {" "}Win and you get <b style={{ color: "var(--fbo-success)" }}>+{myBet.stake}</b>; lose and it&apos;s gone. Results drop Monday.
        </div>
      )}

      {resolved && phase >= 3 && myBet && (
        <div className={`sd-banner sd-banner--${myBet.outcome === "won" ? "won" : myBet.outcome === "lost" ? "lost" : "push"}`}>
          {myBet.outcome === "won" && <>You called it! 🎉<b>+{winnings} pts</b>{pts(myBet.stake)} doubled to {pts(myBet.payout)}</>}
          {myBet.outcome === "lost" && <>Not this time.<b>−{myBet.stake} pts</b>The house thanks you for your contribution.</>}
          {(myBet.outcome === "push" || myBet.outcome === "refunded") && <>Stake returned<b>↩ {myBet.stake} pts</b></>}
          {!compact && <div><button type="button" className="sd-replay" onClick={onReplay}>↻ Replay the reveal</button></div>}
        </div>
      )}
      {resolved && phase >= 3 && !myBet && !compact && (
        <div style={{ textAlign: "center" }}><button type="button" className="sd-replay" onClick={onReplay}>↻ Replay the reveal</button></div>
      )}

      {confirming && selectedMovie && (
        <ConfirmModal
          movie={selectedMovie}
          stake={stake}
          allIn={allIn}
          busy={busy}
          error={error}
          onConfirm={lockIn}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

export default function Showdown(props) {
  const [revealKey, setRevealKey] = useState(0);
  return <ShowdownBody key={revealKey} {...props} onReplay={() => setRevealKey((k) => k + 1)} />;
}
