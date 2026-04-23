import { json, badRequest, requireUser } from "../_auth";
import { hashPasswordPBKDF2, verifyPassword } from "../_crypto";

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");
  const oldPassword = body.oldPassword || "";
  const newPassword = body.newPassword || "";
  if (!oldPassword || !newPassword) return badRequest("Missing fields");
  if (newPassword.length < 8) return badRequest("Password must be at least 8 characters");

  const creds = await env.DB.prepare(
    `SELECT password_salt, password_hash FROM users WHERE id = ? LIMIT 1`
  ).bind(user.id).first();
  if (!creds) return json({ error: "User not found" }, { status: 404 });

  const ok = await verifyPassword(oldPassword, creds.password_salt, creds.password_hash);
  if (!ok) return json({ error: "Current password is incorrect" }, { status: 401 });

  const { saltB64, hashB64 } = await hashPasswordPBKDF2(newPassword);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`
  ).bind(hashB64, saltB64, user.id).run();
  return json({ ok: true });
}
