// /showdown slash command, its autocomplete, and the lock-in confirmation
// buttons. Each handler returns a Discord interaction response body.

import { getBettingWindow } from "../_betting.js";
import {
  getOpenShowdown,
  getCurrentShowdown,
  getShowdownBoard,
  getAvailablePoints,
  parseStake,
  placeShowdownBet,
  insufficientMessage,
  postShowdownLockIn,
  taleOfTheTape,
  fmtWeekend,
  fmtDollars,
  pts,
} from "../_showdown.js";

const LINK_MSG =
  "Your Discord account isn't linked to a league account yet. Log in at https://fantasyboxoffice.pages.dev/ and visit **My Account** to link your Discord ID.";

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

function ephemeral(content) {
  return { type: 4, data: { content, flags: 64 } };
}

// Replaces the ephemeral confirmation message in place.
function updateMessage(content) {
  return { type: 7, data: { content, embeds: [], components: [] } };
}

export async function showdownAutocomplete(interaction, env) {
  const sd = await getOpenShowdown(env.DB);
  if (!sd) return { type: 8, data: { choices: [] } };
  const sub = interaction.data?.options?.[0];
  const typed = (sub?.options?.find((o) => o.focused)?.value || "").trim().toLowerCase();
  const board = await getShowdownBoard(env.DB, sd.weekend_date);
  const choices = board.movies
    .filter((m) => !typed || m.title.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((m) => ({
      name: `${m.title} — ${m.backers} backer${m.backers === 1 ? "" : "s"} · ${pts(m.points)}`.slice(0, 100),
      value: String(m.tmdb_id),
    }));
  return { type: 8, data: { choices } };
}

export async function showdownCommand(interaction, env, leagueUser) {
  const sub = interaction.data.options?.[0];
  if (sub?.name === "board") return boardResponse(env, leagueUser);

  if (!leagueUser) return ephemeral(LINK_MSG);
  const opts = Object.fromEntries((sub?.options || []).map((o) => [o.name, o.value]));

  const sd = await getOpenShowdown(env.DB);
  if (!sd) {
    return ephemeral("No showdown is open right now — one kicks off whenever two or more movies open the same weekend. Check back Monday!");
  }
  const tmdbId = parseInt(opts.movie, 10);
  const movie = sd.movies.find((m) => m.tmdb_id === tmdbId);
  if (!movie) return ephemeral("Pick a movie from the list — that one isn't in this weekend's showdown.");

  const existing = await env.DB.prepare(
    `SELECT tmdb_id, stake FROM showdown_bets WHERE user_id = ? AND weekend_date = ?`
  ).bind(leagueUser.id, sd.weekend_date).first();
  if (existing) {
    const title = sd.movies.find((m) => m.tmdb_id === existing.tmdb_id)?.title ?? "another movie";
    return ephemeral(`You're already locked in: **${pts(existing.stake)}** on **${title}**. Showdown bets are final — see \`/showdown board\`.`);
  }

  const { balance, held, available } = await getAvailablePoints(env.DB, leagueUser.id);
  const stake = parseStake(opts.points, available);
  if (!stake) return ephemeral("Stake a whole number of points (at least 1), or type `all` to go all in.");
  if (stake > available) return ephemeral(insufficientMessage(available, held));

  const allIn = stake === available;
  const winBalance = balance + stake;
  const loseBalance = balance - stake;
  const embed = {
    title: allIn ? `🚨 ALL IN on ${movie.title}?` : `⚔️ Back ${movie.title}?`,
    description: [
      `**Stake:** ${pts(stake)}${allIn ? " — everything you've got" : ""}`,
      `🟢 **If it wins the weekend:** +${stake} → **${pts(winBalance)}**`,
      `🔴 **If it doesn't:** −${stake} → **${pts(loseBalance)}**${loseBalance === 0 ? " 💀" : ""}`,
      "",
      `Showdown bets are **final** once locked. Betting closes <t:${unix(sd.closes_at)}:R>.`,
    ].join("\n"),
    color: allIn ? 0xef4444 : 0xf59e0b,
    ...(movie.poster_url ? { thumbnail: { url: movie.poster_url } } : {}),
  };
  const components = [{
    type: 1,
    components: [
      {
        type: 2,
        style: allIn ? 4 : 3,
        label: allIn ? `Go all in — ${pts(stake)}` : `Lock in ${pts(stake)}`,
        emoji: { name: "🔒" },
        custom_id: `sd:lock:${sd.weekend_date}:${tmdbId}:${stake}`,
      },
      { type: 2, style: 2, label: "Cancel", custom_id: "sd:cancel" },
    ],
  }];
  return { type: 4, data: { flags: 64, embeds: [embed], components } };
}

export async function showdownComponent(interaction, env, leagueUser, waitUntil) {
  const [, action, weekendDate, tmdbStr, stakeStr] = (interaction.data?.custom_id || "").split(":");
  if (action === "cancel") return updateMessage("Cancelled — no points staked.");
  if (!leagueUser) return updateMessage(LINK_MSG);

  const result = await placeShowdownBet(env.DB, {
    userId: leagueUser.id,
    weekendDate,
    tmdbId: parseInt(tmdbStr, 10),
    stake: parseInt(stakeStr, 10),
  });
  if (result.error) return updateMessage(`❌ ${result.error}`);

  const [board, { closes_at }] = await Promise.all([
    getShowdownBoard(env.DB, weekendDate),
    getBettingWindow(env.DB, weekendDate),
  ]);
  const post = postShowdownLockIn(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
    board,
    who: `<@${leagueUser.discord_user_id}>`,
    movie: result.movie,
    stake: result.stake,
    allIn: result.all_in,
    closesAt: closes_at,
  });
  if (waitUntil) waitUntil(post);
  else await post;

  return updateMessage(
    result.all_in
      ? `🚨 **ALL IN.** ${pts(result.stake)} on **${result.movie.title}** — locked. Godspeed. Results drop Monday.`
      : `🔒 **Locked in:** ${pts(result.stake)} on **${result.movie.title}**. Results drop Monday. Balance: **${pts(result.balance)}**.`
  );
}

async function boardResponse(env, leagueUser) {
  const sd = await getCurrentShowdown(env.DB);
  if (!sd) return ephemeral("No showdown right now — one kicks off whenever two or more movies open the same weekend.");

  const board = await getShowdownBoard(env.DB, sd.weekend_date);
  const lines = [`## ⚔️ Showdown — ${fmtWeekend(sd.weekend_date)}`];

  if (board.result?.status === "settled") {
    const winner = board.movies.find((m) => m.tmdb_id === board.result.winner_tmdb_id);
    lines.push(`🏆 **${winner?.title}** won the weekend with ${fmtDollars(board.result.grosses[winner?.tmdb_id] ?? 0)}.`);
  } else if (board.result?.status === "push") {
    lines.push("🤝 Dead heat — every stake was refunded.");
  } else if (sd.is_open) {
    lines.push(`Betting closes <t:${unix(sd.closes_at)}:F> (<t:${unix(sd.closes_at)}:R>)`);
  } else {
    lines.push("🍿 Betting's closed — results drop Monday.");
  }

  lines.push("", taleOfTheTape(board.movies), "");
  for (const m of board.movies) {
    const backers = board.bets.filter((b) => b.tmdb_id === m.tmdb_id && b.outcome !== "refunded");
    if (backers.length) lines.push(`**${m.title}:** ${backers.map((b) => `${b.username} (${b.stake})`).join(", ")}`);
  }

  if (leagueUser) {
    const mine = board.bets.find((b) => b.user_id === leagueUser.id);
    if (mine) {
      const title = board.movies.find((m) => m.tmdb_id === mine.tmdb_id)?.title;
      const outcome = {
        won: ` — 🟢 won **+${mine.stake}**`,
        lost: ` — 🔴 lost **${mine.stake}**`,
        push: " — ↩️ refunded",
        refunded: " — ↩️ refunded",
      }[mine.outcome] ?? "";
      lines.push("", `**Your bet:** ${pts(mine.stake)} on **${title}**${outcome}`);
    } else if (sd.is_open) {
      const { available } = await getAvailablePoints(env.DB, leagueUser.id);
      lines.push("", `You're not in yet — **${pts(available)}** available. Use \`/showdown pick\`.`);
    }
  }
  return ephemeral(lines.join("\n"));
}
