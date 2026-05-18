import { json, badRequest, requireUser } from "../_auth";
import { bootstrapSchema } from "../_schema";

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  await bootstrapSchema(env.DB);

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");

  const discordUserId = body.discord_user_id?.toString().trim() || null;

  if (discordUserId !== null && !/^\d{17,20}$/.test(discordUserId)) {
    return badRequest("Invalid Discord user ID — it should be a 17–20 digit number. Enable Developer Mode in Discord to copy it.");
  }

  // Prevent two accounts sharing the same Discord ID.
  if (discordUserId) {
    const taken = await env.DB.prepare(
      `SELECT id FROM users WHERE discord_user_id = ? AND id != ? LIMIT 1`
    ).bind(discordUserId, user.id).first();
    if (taken) return badRequest("That Discord account is already linked to a different league account.");
  }

  await env.DB.prepare(
    `UPDATE users SET discord_user_id = ? WHERE id = ?`
  ).bind(discordUserId, user.id).run();

  return json({ ok: true });
}
