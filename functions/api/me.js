import { json, requireUser } from "./_auth";

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;
  return json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      real_name: user.real_name,
      created_at: user.created_at,
      is_admin: !!user.is_admin,
      points_remaining: user.points_remaining,
    },
  });
}
