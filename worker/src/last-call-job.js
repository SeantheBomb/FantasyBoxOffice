import { getOpenWeekends } from "../../functions/api/_betting.js";
import { getShowdownBoard, taleOfTheTape } from "../../functions/api/_showdown.js";

export async function runLastCallPost(env) {
  if (!env.DISCORD_WEBHOOK_URL) return { error: "DISCORD_WEBHOOK_URL missing" };

  const [weekend] = await getOpenWeekends(env.DB);

  if (!weekend) return { skipped: "no upcoming weekend movies" };

  const weekendDate = weekend.weekend_date;

  const { results: movies } = await env.DB.prepare(
    `SELECT m.title, u.username AS owner,
            (SELECT COUNT(*) FROM weekend_picks wp
             WHERE wp.tmdb_id = wm.tmdb_id AND wp.weekend_date = wm.weekend_date) AS bettors
     FROM weekend_movies wm
     JOIN movies m ON m.tmdb_id = wm.tmdb_id
     LEFT JOIN owned_movies om ON om.tmdb_id = wm.tmdb_id AND om.is_void = 0
     LEFT JOIN users u ON u.id = om.owner_user_id
     WHERE wm.weekend_date = ?
     ORDER BY m.title`
  ).bind(weekendDate).all();

  if (!movies.length) return { skipped: "no upcoming weekend movies" };

  // Mention only in-league users with a Discord ID who haven't bet on all movies yet
  const { results: missing } = await env.DB.prepare(
    `SELECT u.discord_user_id, u.username
     FROM users u
     WHERE u.in_league = 1 AND u.discord_user_id IS NOT NULL
       AND (
         SELECT COUNT(*) FROM weekend_picks wp
         WHERE wp.discord_user_id = u.discord_user_id AND wp.weekend_date = ?
       ) < ?`
  ).bind(weekendDate, movies.length).all();

  let showdownSection = "";
  let showdownMissing = [];
  if (movies.length >= 2) {
    const board = await getShowdownBoard(env.DB, weekendDate);
    const entered = new Set(board.bets.map((b) => b.discord_user_id));
    const { results: league } = await env.DB.prepare(
      `SELECT discord_user_id FROM users WHERE in_league = 1 AND discord_user_id IS NOT NULL`
    ).all();
    showdownMissing = league.filter((u) => !entered.has(u.discord_user_id));
    const sittingOut = showdownMissing.length
      ? `Still sitting it out: ${showdownMissing.map((u) => `<@${u.discord_user_id}>`).join(" ")}`
      : "Everyone's in the ring. 🥊";
    showdownSection = `\n\n### ⚔️ Showdown — double or nothing\n${taleOfTheTape(board.movies)}\n${sittingOut}\nPick the weekend winner with \`/showdown pick\`.`;
  }

  if (!missing.length && !showdownMissing.length) return { skipped: "all players have placed their bets" };

  const mentionIds = [...new Set([...missing, ...showdownMissing].map((u) => u.discord_user_id))];
  const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");
  const list = movies.map((m) => `• **${m.title}**${m.owner ? ` — owned by ${m.owner}` : ""}${noPointsWarning(m.bettors)}`).join("\n");
  const anyAtRisk = movies.some((m) => m.bettors <= 1);
  const footer = anyAtRisk
    ? "\n\n⚠️ A movie with fewer than 2 bets awards **no points** — winning a bet needs someone to beat."
    : "";
  const closesUnix = Math.floor(Date.parse(weekend.closes_at) / 1000);
  const content = `${mentions}\n📣 **Last call!** Betting closes <t:${closesUnix}:F> (<t:${closesUnix}:R>). Use \`/bet\` to lock in your picks!\n\n${list}${footer}${showdownSection}`;

  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `Discord ${res.status}: ${text}` };
  }

  return { posted: true, mentioned: mentionIds.length, movies: movies.length };
}

function noPointsWarning(bettors) {
  if (bettors === 0) return " — ⚠️ **no bets yet, no points will be awarded**";
  if (bettors === 1) return " — ⚠️ **only 1 bet, no points will be awarded** unless someone else bets";
  return "";
}
