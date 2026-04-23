import { json, badRequest, requireUser } from "../_auth";

// Lets a signed-in user change their own username.
// Email changes are blocked here — they require an email-verification flow
// we haven't built yet. Admins can change emails via /api/admin/users/:id.
export async function onRequestPost({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");
  const username = (body.username || "").trim();
  if (!username) return badRequest("Username is required");
  if (username.length < 2 || username.length > 40) return badRequest("Username must be 2–40 characters");

  try {
    await env.DB.prepare(`UPDATE users SET username = ? WHERE id = ?`)
      .bind(username, user.id).run();
  } catch (e) {
    const msg = e?.message || "";
    if (msg.includes("UNIQUE") || msg.includes("unique"))
      return json({ error: "Username is already taken" }, { status: 409 });
    throw e;
  }
  return json({ ok: true, username });
}
