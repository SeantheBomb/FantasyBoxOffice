import { json, requireAdmin } from "../../_auth";

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.real_name, u.is_admin, u.points_remaining, u.created_at,
            (SELECT COUNT(*) FROM owned_movies o WHERE o.owner_user_id = u.id AND o.is_void = 0) AS owned_count
       FROM users u ORDER BY u.username`
  ).all();

  return json({ users: results || [] });
}
