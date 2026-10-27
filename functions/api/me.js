import { json, requireUser } from "./_auth";
import { bootstrapSchema } from "./_schema";

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;
  await bootstrapSchema(env.DB);
  const inPlay = await env.DB.prepare(
    `SELECT COALESCE(SUM(stake), 0) AS n FROM showdown_bets WHERE user_id = ? AND outcome IS NULL`
  ).bind(user.id).first();
  return json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      real_name: user.real_name,
      created_at: user.created_at,
      is_admin: !!user.is_admin,
      points_remaining: user.points_remaining,
      points_in_play: inPlay?.n ?? 0,
    },
  });
}
