import { json, badRequest, requireAdmin } from "../../../_auth";

// Admin-only: edit a user's username and/or email.
export async function onRequestPost({ request, params, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");
  const updates = [];
  const binds = [];
  if (typeof body.username === "string") {
    const v = body.username.trim();
    if (!v) return badRequest("Username cannot be empty");
    updates.push("username = ?");
    binds.push(v);
  }
  if (typeof body.email === "string") {
    const v = body.email.trim().toLowerCase();
    if (!v) return badRequest("Email cannot be empty");
    updates.push("email = ?");
    binds.push(v);
  }
  if (typeof body.real_name === "string") {
    updates.push("real_name = ?");
    binds.push(body.real_name.trim());
  }
  if (!updates.length) return badRequest("No updatable fields provided");

  binds.push(params.id);
  try {
    await env.DB.prepare(
      `UPDATE users SET ${updates.join(", ")} WHERE id = ?`
    ).bind(...binds).run();
  } catch (e) {
    const msg = e?.message || "";
    if (msg.includes("UNIQUE") || msg.includes("unique"))
      return json({ error: "Email or username already in use" }, { status: 409 });
    throw e;
  }
  return json({ ok: true });
}
