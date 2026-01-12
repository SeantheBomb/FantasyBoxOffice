import { hashPasswordPBKDF2 } from "./_crypto";
import { json, badRequest, setSessionCookie } from "./_auth";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");

  const { email, username, realName, password } = body;
  if (!email || !username || !realName || !password) return badRequest("Missing fields");

  const { saltB64, hashB64 } = await hashPasswordPBKDF2(password);

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, username, real_name, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(userId, email.toLowerCase(), username, realName, hashB64, saltB64, now)
      .run();
  } catch {
    return json({ error: "Email or username already exists" }, { status: 409 });
  }

  const sessionId = crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  )
    .bind(sessionId, userId, expires, now)
    .run();

  return json(
    { ok: true },
    { headers: { "Set-Cookie": setSessionCookie(sessionId, request) } }
  );
}
