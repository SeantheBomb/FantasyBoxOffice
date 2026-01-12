import { json, getCookie } from "./_auth";

export async function onRequestGet({ request, env }) {
  const sessionId = getCookie(request, "session");
  if (!sessionId) return json({ error: "Not signed in" }, { status: 401 });

  const s = await env.DB.prepare(
    `SELECT user_id, expires_at FROM sessions WHERE id = ? LIMIT 1`
  )
    .bind(sessionId)
    .first();

  if (!s) return json({ error: "Not signed in" }, { status: 401 });
  if (new Date(s.expires_at).getTime() < Date.now()) {
    return json({ error: "Session expired" }, { status: 401 });
  }

  const u = await env.DB.prepare(
    `SELECT email, username, real_name, created_at FROM users WHERE id = ? LIMIT 1`
  )
    .bind(s.user_id)
    .first();

  return json({ user: u });
}
