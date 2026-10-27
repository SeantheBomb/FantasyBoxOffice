// Weekend showdown: every weekend with 2+ lineup movies is a showdown. Players
// pick the movie they think grosses the most and stake points on it, double
// or nothing. Stakes are escrowed (deducted from points_remaining) when placed;
// settlement credits 2x stake to winners and nothing to losers. An exact tie
// for first refunds everyone.
//
// Shared by Pages Functions (web + Discord bot) and the cron worker.

import { bootstrapSchema } from "./_schema.js";
import { getOpenWeekends, getBettingWindow } from "./_betting.js";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Points a user is currently the high bidder for. Auctions don't escrow, so
// without this an all-in stake followed by an auction win goes negative.
const HELD_IN_AUCTIONS = `COALESCE((SELECT SUM(current_bid) FROM auctions
  WHERE status = 'open' AND current_bidder_id = ?), 0)`;

export function fmtWeekend(date) {
  const [, m, d] = date.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${Number(d)}`;
}

export function fmtDollars(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtMargin(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return fmtDollars(n);
}

export function pts(n) {
  return `${n} pt${n === 1 ? "" : "s"}`;
}

export function mention(u) {
  return u.discord_user_id ? `<@${u.discord_user_id}>` : `**${u.username}**`;
}

export async function getShowdownMovies(db, weekendDate) {
  const { results } = await db
    .prepare(
      `SELECT m.tmdb_id, m.title, m.poster_url, m.bom_slug, u.username AS owner
       FROM weekend_movies wm
       JOIN movies m ON m.tmdb_id = wm.tmdb_id
       LEFT JOIN owned_movies om ON om.tmdb_id = wm.tmdb_id AND om.is_void = 0
       LEFT JOIN users u ON u.id = om.owner_user_id
       WHERE wm.weekend_date = ?
       ORDER BY m.title`
    )
    .bind(weekendDate)
    .all();
  return results;
}

// Earliest weekend still taking bets that has a showdown.
export async function getOpenShowdown(db) {
  for (const w of await getOpenWeekends(db)) {
    const movies = await getShowdownMovies(db, w.weekend_date);
    if (movies.length >= 2) return { ...w, movies };
  }
  return null;
}

// The open showdown, else the most recent one from the past week (closed,
// in theaters, or settled) so players can still follow it.
export async function getCurrentShowdown(db) {
  const open = await getOpenShowdown(db);
  if (open) return { weekend_date: open.weekend_date, closes_at: open.closes_at, is_open: true };
  const row = await db
    .prepare(
      `SELECT weekend_date FROM weekend_movies
       WHERE weekend_date >= date('now', '-7 days')
       GROUP BY weekend_date HAVING COUNT(*) >= 2
       ORDER BY weekend_date DESC LIMIT 1`
    )
    .first();
  if (!row) return null;
  const { closes_at } = await getBettingWindow(db, row.weekend_date);
  return { weekend_date: row.weekend_date, closes_at, is_open: false };
}

export async function getAvailablePoints(db, userId) {
  const row = await db
    .prepare(`SELECT points_remaining, ${HELD_IN_AUCTIONS} AS held FROM users WHERE id = ?`)
    .bind(userId, userId)
    .first();
  const balance = row?.points_remaining ?? 0;
  const held = row?.held ?? 0;
  return { balance, held, available: Math.max(balance - held, 0) };
}

// "all", "all in", "all-in", "max" → everything available.
export function parseStake(input, available) {
  const s = String(input ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (s === "all" || s === "allin" || s === "max") return available;
  if (!/^\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

export function insufficientMessage(available, held) {
  const heldNote = held ? ` (${pts(held)} are tied up as your leading bids in open auctions)` : "";
  return available
    ? `You only have **${pts(available)}** available${heldNote}.`
    : `You have no points available to stake${heldNote}.`;
}

// Validates and places a bet atomically. Returns { ok, movie, stake, all_in,
// balance } or { error } with a player-facing message.
export async function placeShowdownBet(db, { userId, weekendDate, tmdbId, stake }) {
  await bootstrapSchema(db);
  if (!Number.isInteger(stake) || stake < 1) {
    return { error: "Stake must be a whole number of at least 1 point." };
  }

  const open = await getOpenWeekends(db);
  if (!open.some((w) => w.weekend_date === weekendDate)) {
    return { error: "Betting is closed for this showdown." };
  }
  const movies = await getShowdownMovies(db, weekendDate);
  if (movies.length < 2) return { error: "There's no showdown this weekend — it needs at least two movies." };
  const movie = movies.find((m) => m.tmdb_id === tmdbId);
  if (!movie) return { error: "That movie isn't in this weekend's showdown." };

  const existing = await db
    .prepare(`SELECT tmdb_id, stake FROM showdown_bets WHERE user_id = ? AND weekend_date = ?`)
    .bind(userId, weekendDate)
    .first();
  if (existing) {
    const title = movies.find((m) => m.tmdb_id === existing.tmdb_id)?.title ?? "another movie";
    return { error: `You're already locked in: **${pts(existing.stake)}** on **${title}**. Showdown bets are final.` };
  }

  const { available, held } = await getAvailablePoints(db, userId);
  if (stake > available) return { error: insufficientMessage(available, held) };

  // The INSERT re-checks the balance inside the transaction, and the deduction
  // only applies if that INSERT landed — no double-spend between check and write.
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO showdown_bets (id, user_id, weekend_date, tmdb_id, stake)
         SELECT ?, ?, ?, ?, ?
         WHERE (SELECT points_remaining FROM users WHERE id = ?) - ${HELD_IN_AUCTIONS} >= ?`
      ).bind(id, userId, weekendDate, tmdbId, stake, userId, userId, stake),
      db.prepare(
        `UPDATE users SET points_remaining = points_remaining - ?
         WHERE id = ? AND EXISTS (SELECT 1 FROM showdown_bets WHERE id = ?)`
      ).bind(stake, userId, id),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) {
      return { error: "You're already locked in for this showdown. Showdown bets are final." };
    }
    throw e;
  }

  const placed = await db.prepare(`SELECT id FROM showdown_bets WHERE id = ?`).bind(id).first();
  if (!placed) return { error: "Your available points just changed — check your balance and try again." };

  const after = await getAvailablePoints(db, userId);
  return { ok: true, movie, stake, all_in: stake === available, balance: after.balance };
}

export async function getShowdownBoard(db, weekendDate) {
  await bootstrapSchema(db);
  const [movies, { results: bets }, result] = await Promise.all([
    getShowdownMovies(db, weekendDate),
    db.prepare(
      `SELECT b.id, b.user_id, b.tmdb_id, b.stake, b.outcome, b.payout, b.created_at,
              u.username, u.discord_user_id
       FROM showdown_bets b
       JOIN users u ON u.id = b.user_id
       WHERE b.weekend_date = ?
       ORDER BY b.stake DESC, b.created_at`
    ).bind(weekendDate).all(),
    db.prepare(
      `SELECT status, winner_tmdb_id, grosses, settled_at FROM showdown_results WHERE weekend_date = ?`
    ).bind(weekendDate).first(),
  ]);

  const live = bets.filter((b) => b.outcome !== "refunded");
  const tallied = movies.map((m) => {
    const backing = live.filter((b) => b.tmdb_id === m.tmdb_id);
    return { ...m, backers: backing.length, points: backing.reduce((s, b) => s + b.stake, 0) };
  });

  return {
    weekend_date: weekendDate,
    movies: tallied,
    bets,
    result: result ? { ...result, grosses: JSON.parse(result.grosses) } : null,
  };
}

// Proportional share bar of the points riding on each movie.
export function taleOfTheTape(movies) {
  const total = movies.reduce((s, m) => s + m.points, 0);
  return movies
    .map((m) => {
      const filled = total ? Math.round((m.points / total) * 10) : 0;
      const bar = "▰".repeat(filled) + "▱".repeat(10 - filled);
      return `\`${bar}\` **${m.title}** — ${m.backers} backer${m.backers === 1 ? "" : "s"} · ${pts(m.points)}`;
    })
    .join("\n");
}

// Latest cumulative BOM number within the opening weekend window — the same
// snapshot the Monday /bet scoring uses, but kept to the dollar.
export async function getShowdownGrosses(db, weekendDate, movies) {
  const grosses = {};
  const missing = [];
  for (const m of movies) {
    const row = await db
      .prepare(
        `SELECT domestic_revenue FROM dailies
         WHERE tmdb_id = ? AND date BETWEEN ? AND date(?, '+3 days')
         ORDER BY date DESC LIMIT 1`
      )
      .bind(m.tmdb_id, weekendDate, weekendDate)
      .first();
    if (row?.domestic_revenue) grosses[m.tmdb_id] = row.domestic_revenue;
    else missing.push(m.title);
  }
  return { grosses, missing };
}

// Settles a showdown once. `grosses` ({ tmdb_id: dollars }) overrides the BOM
// lookup for an admin manual settle. Returns { status } where status is
// settled | push | pending | already_settled, plus a Discord `content` when
// it settled and anyone had a bet.
export async function settleShowdown(db, weekendDate, { grosses: override } = {}) {
  const board = await getShowdownBoard(db, weekendDate);
  if (board.result) return { status: "already_settled", board };

  let grosses;
  if (override) {
    const missing = board.movies.filter((m) => !(Number(override[m.tmdb_id]) > 0)).map((m) => m.title);
    if (missing.length) return { status: "pending", missing };
    grosses = Object.fromEntries(board.movies.map((m) => [m.tmdb_id, Math.round(Number(override[m.tmdb_id]))]));
  } else {
    const found = await getShowdownGrosses(db, weekendDate, board.movies);
    if (found.missing.length) return { status: "pending", missing: found.missing };
    grosses = found.grosses;
  }

  const ranked = board.movies
    .map((m) => ({ ...m, gross: grosses[m.tmdb_id] }))
    .sort((a, b) => b.gross - a.gross);
  const lineupIds = new Set(board.movies.map((m) => m.tmdb_id));
  const tie = ranked.length < 2 || ranked[0].gross === ranked[1].gross;
  const status = tie ? "push" : "settled";
  const winnerId = tie ? null : ranked[0].tmdb_id;

  // A bet on a movie that left the lineup is refunded rather than lost.
  const outcomes = board.bets
    .filter((b) => !b.outcome)
    .map((b) => {
      if (tie || !lineupIds.has(b.tmdb_id)) return { ...b, outcome: "push", payout: b.stake };
      return b.tmdb_id === winnerId
        ? { ...b, outcome: "won", payout: b.stake * 2 }
        : { ...b, outcome: "lost", payout: 0 };
    });

  // The results INSERT is the once-only guard: a concurrent settle hits the
  // primary key and the whole batch rolls back. Credits are applied before the
  // bet is marked, conditioned on it still being open.
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO showdown_results (weekend_date, status, winner_tmdb_id, grosses) VALUES (?, ?, ?, ?)`
      ).bind(weekendDate, status, winnerId, JSON.stringify(grosses)),
      ...outcomes.flatMap((o) => [
        ...(o.payout > 0
          ? [db.prepare(
              `UPDATE users SET points_remaining = points_remaining + ?
               WHERE id = ? AND EXISTS (SELECT 1 FROM showdown_bets WHERE id = ? AND outcome IS NULL)`
            ).bind(o.payout, o.user_id, o.id)]
          : []),
        db.prepare(
          `UPDATE showdown_bets SET outcome = ?, payout = ?, settled_at = datetime('now')
           WHERE id = ? AND outcome IS NULL`
        ).bind(o.outcome, o.payout, o.id),
      ]),
    ]);
  } catch (e) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(e?.message))) {
      return { status: "already_settled", board: await getShowdownBoard(db, weekendDate) };
    }
    throw e;
  }

  const balances = {};
  if (outcomes.length) {
    const { results } = await db
      .prepare(`SELECT id, points_remaining FROM users WHERE id IN (SELECT user_id FROM showdown_bets WHERE weekend_date = ?)`)
      .bind(weekendDate)
      .all();
    for (const u of results) balances[u.id] = u.points_remaining;
  }

  const content = outcomes.length
    ? buildShowdownResults({ weekendDate, ranked, outcomes, status, balances, movies: board.movies })
    : null;
  return { status, winner_tmdb_id: winnerId, ranked, outcomes, content };
}

export function buildShowdownResults({ weekendDate, ranked, outcomes, status, balances, movies }) {
  const titleOf = Object.fromEntries(movies.map((m) => [m.tmdb_id, m.title]));
  const lines = [`## ⚔️ Showdown Results — ${fmtWeekend(weekendDate)}`];

  if (status === "push") {
    lines.push(
      ranked.length >= 2
        ? `🤝 **DEAD HEAT!** **${ranked[0].title}** and **${ranked[1].title}** tied to the dollar at **${fmtDollars(ranked[0].gross)}**. Every stake is refunded.`
        : "The showdown was called off — every stake is refunded.",
      ""
    );
    for (const o of outcomes) lines.push(`↩️ ${mention(o)} · ${pts(o.stake)} refunded`);
    return lines.join("\n");
  }

  const [winner, runnerUp] = ranked;
  const medals = ["🏆", "🥈", "🥉"];
  const podium = ranked.map((m, i) => `${medals[i] ?? "▫️"} **${m.title}** — ${fmtDollars(m.gross)}`).join("\n");
  const maxOtherPoints = Math.max(...ranked.slice(1).map((m) => m.points));
  const upset = winner.points < maxOtherPoints ? "\n🐶 **UPSET!** The smart money was on the other side." : "";

  lines.push(
    "The envelope, please… 🥁  *(tap to reveal)*",
    "",
    `||${podium}\nWon by **${fmtMargin(winner.gross - runnerUp.gross)}**${upset}||`
  );

  const byStake = (a, b) => b.stake - a.stake;
  const won = outcomes.filter((o) => o.outcome === "won").sort(byStake);
  const lost = outcomes.filter((o) => o.outcome === "lost").sort(byStake);
  const pushed = outcomes.filter((o) => o.outcome === "push");

  const payoutLines = [
    ...won.map((o) => `🟢 ${mention(o)} backed **${titleOf[o.tmdb_id]}** · **+${o.stake}** → ${pts(balances[o.user_id] ?? 0)}`),
    ...lost.map((o) => {
      const bal = balances[o.user_id] ?? 0;
      return `🔴 ${mention(o)} backed **${titleOf[o.tmdb_id]}** · **−${o.stake}** → ${pts(bal)}${bal === 0 ? " 💀 **BUSTED**" : ""}`;
    }),
    ...pushed.map((o) => `↩️ ${mention(o)} · ${pts(o.stake)} refunded (movie left the lineup)`),
  ];

  const paidOut = won.reduce((s, o) => s + o.stake, 0);
  const collected = lost.reduce((s, o) => s + o.stake, 0);
  const callouts = [];
  if (won.length) callouts.push(`💰 Biggest haul: ${mention(won[0])} **+${won[0].stake}**`);
  if (!won.length) callouts.push("🦗 Nobody called it. The house sweeps the table.");
  else if (!lost.length) callouts.push("🎯 Clean sweep — everyone called it!");
  callouts.push(`🏦 House paid out **${pts(paidOut)}** · collected **${pts(collected)}**`);

  lines.push("", "**Payouts**", `||${payoutLines.join("\n")}\n\n${callouts.join("\n")}||`);
  return lines.join("\n");
}

// Refunds every open bet on a movie (e.g. pulled from the lineup).
export async function refundShowdownBetsForMovie(db, tmdbId, weekendDate) {
  await bootstrapSchema(db);
  const { results } = await db
    .prepare(
      `SELECT id, user_id, stake FROM showdown_bets
       WHERE tmdb_id = ? AND weekend_date = ? AND outcome IS NULL`
    )
    .bind(tmdbId, weekendDate)
    .all();
  if (results.length) await db.batch(results.flatMap((b) => refundStatements(db, b)));
  return results;
}

export function refundStatements(db, bet) {
  return [
    db.prepare(
      `UPDATE users SET points_remaining = points_remaining + ?
       WHERE id = ? AND EXISTS (SELECT 1 FROM showdown_bets WHERE id = ? AND outcome IS NULL)`
    ).bind(bet.stake, bet.user_id, bet.id),
    db.prepare(
      `UPDATE showdown_bets SET outcome = 'refunded', payout = stake, settled_at = datetime('now')
       WHERE id = ? AND outcome IS NULL`
    ).bind(bet.id),
  ];
}

// Returns true only for the first caller per (weekend, kind).
export async function claimShowdownPost(db, weekendDate, kind) {
  await bootstrapSchema(db);
  const res = await db
    .prepare(`INSERT OR IGNORE INTO showdown_posts (weekend_date, kind) VALUES (?, ?)`)
    .bind(weekendDate, kind)
    .run();
  return res.meta?.changes === 1;
}

export async function postShowdownLockIn(webhookUrl, { board, who, movie, stake, allIn, closesAt }) {
  if (!webhookUrl) return;
  const content = allIn
    ? `🚨 **ALL IN!** ${who} shoves **${pts(stake)}** onto **${movie.title}**`
    : `⚔️ ${who} backs **${movie.title}** with **${pts(stake)}**`;
  const closes = Math.floor(Date.parse(closesAt) / 1000);
  const embed = {
    title: `⚔️ Showdown — ${fmtWeekend(board.weekend_date)} · Tale of the Tape`,
    description: `${taleOfTheTape(board.movies)}\n\nBetting closes <t:${closes}:R> · join with \`/showdown pick\``,
    color: allIn ? 0xef4444 : 0xf59e0b,
    ...(movie.poster_url ? { thumbnail: { url: movie.poster_url } } : {}),
  };
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, embeds: [embed] }),
  }).catch(() => {});
}

export async function postShowdownContent(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => res.statusText)}`);
}
