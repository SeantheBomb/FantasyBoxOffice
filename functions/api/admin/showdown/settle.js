import { json, badRequest, requireAdmin } from "../../_auth.js";
import { settleShowdown, postShowdownContent } from "../../_showdown.js";

// POST { weekend_date, grosses?: { tmdb_id: dollars }, notify? }
// Without grosses, settles from BOM dailies (same as the Monday job).
export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.weekend_date) return badRequest("weekend_date required");

  const result = await settleShowdown(env.DB, body.weekend_date, { grosses: body.grosses || undefined });
  if (result.status === "already_settled") return badRequest("This showdown is already settled");
  if (result.status === "pending") {
    return badRequest(`Missing grosses for: ${result.missing.join(", ")}`);
  }

  let posted = false;
  if (result.content && body.notify !== false && env.DISCORD_WEBHOOK_URL) {
    await postShowdownContent(env.DISCORD_WEBHOOK_URL, result.content);
    posted = true;
  }
  return json({ ok: true, status: result.status, winner_tmdb_id: result.winner_tmdb_id, bets: result.outcomes.length, posted });
}
