// Thursday last-call post: @everyone reminder in #movie-chat that betting
// closes when movies hit theaters on Friday.

export async function runLastCallPost(env) {
  if (!env.DISCORD_MOVIE_CHAT_WEBHOOK_URL) return { error: "DISCORD_MOVIE_CHAT_WEBHOOK_URL missing" };

  const { results: movies } = await env.DB.prepare(
    `SELECT m.title, u.username AS owner
     FROM weekend_movies wm
     JOIN movies m ON m.tmdb_id = wm.tmdb_id
     JOIN owned_movies om ON om.tmdb_id = wm.tmdb_id AND om.is_void = 0
     JOIN users u ON u.id = om.owner_user_id
     WHERE wm.weekend_date > date('now')
     ORDER BY m.title`
  ).all();

  if (!movies.length) return { skipped: "no upcoming weekend movies" };

  const list = movies.map((m) => `• **${m.title}** — owned by ${m.owner}`).join("\n");
  const content = `@everyone 📣 **Last call!** Betting closes when movies hit theaters **Friday**. Use \`/bet\` to lock in your picks before then!\n\n${list}`;

  const res = await fetch(env.DISCORD_MOVIE_CHAT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `Discord ${res.status}: ${text}` };
  }

  return { posted: true, movies: movies.length };
}
