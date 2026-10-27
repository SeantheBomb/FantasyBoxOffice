import { json, badRequest, requireAdmin } from "../../_auth.js";
import { refundStatements, mention, pts } from "../../_showdown.js";

// POST { bet_id } — voids an unsettled showdown bet and returns the stake.
export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.bet_id) return badRequest("bet_id required");

  const bet = await env.DB.prepare(
    `SELECT b.id, b.user_id, b.stake, b.outcome, m.title, u.username, u.discord_user_id
     FROM showdown_bets b
     JOIN users u ON u.id = b.user_id
     LEFT JOIN movies m ON m.tmdb_id = b.tmdb_id
     WHERE b.id = ?`
  ).bind(body.bet_id).first();
  if (!bet) return badRequest("Bet not found");
  if (bet.outcome) return badRequest("This bet is already settled");

  await env.DB.batch(refundStatements(env.DB, bet));

  if (env.DISCORD_GAME_FEED_WEBHOOK_URL) {
    await fetch(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `↩️ ${mention(bet)}'s showdown stake (**${pts(bet.stake)}** on **${bet.title}**) was refunded by an admin.`,
      }),
    }).catch(() => {});
  }
  return json({ ok: true });
}
