export async function runLastCallPost(env) {
  if (!env.DISCORD_GAME_FEED_WEBHOOK_URL) return { error: "DISCORD_GAME_FEED_WEBHOOK_URL missing" };

  const weekend = await env.DB.prepare(
    `SELECT MIN(weekend_date) as weekend_date FROM weekend_movies WHERE weekend_date > date('now')`
  ).first();

  if (!weekend?.weekend_date) return { skipped: "no upcoming weekend movies" };

  const weekendDate = weekend.weekend_date;

  const { results: movies } = await env.DB.prepare(
    `SELECT m.title, u.username AS owner
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

  if (!missing.length) return { skipped: "all players have placed their bets" };

  const mentions = missing.map((u) => `<@${u.discord_user_id}>`).join(" ");
  const list = movies.map((m) => `• **${m.title}**${m.owner ? ` — owned by ${m.owner}` : ""}`).join("\n");
  const content = `${mentions}\n📣 **Last call!** Betting closes when movies hit theaters **Friday**. Use \`/bet\` to lock in your picks!\n\n${list}`;

  const res = await fetch(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `Discord ${res.status}: ${text}` };
  }

  return { posted: true, mentioned: missing.length, movies: movies.length };
}
