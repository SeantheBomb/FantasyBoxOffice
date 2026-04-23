import { json, requireAdmin } from "../../../_auth";
import { hashPasswordPBKDF2 } from "../../../_crypto";

// Admin-triggered password reset. Generates a fresh random password, sets it
// on the user, and returns it so the admin can pass it to the player.
// (Proper email delivery needs SPF/DKIM on a verified sending domain; until
// that's wired up the admin shares the temp password over Discord/etc.)
function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b64.slice(0, 16);
}

export async function onRequestPost({ request, params, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const existing = await env.DB.prepare(
    `SELECT id, email, username FROM users WHERE id = ? LIMIT 1`
  ).bind(params.id).first();
  if (!existing) return json({ error: "User not found" }, { status: 404 });

  const pw = randomPassword();
  const { saltB64, hashB64 } = await hashPasswordPBKDF2(pw);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`
  ).bind(hashB64, saltB64, params.id).run();

  return json({
    ok: true,
    email: existing.email,
    username: existing.username,
    temporary_password: pw,
    message: `Share this password with ${existing.username}. They should change it after signing in.`,
  });
}
