import { verifyPassword } from "./_crypto";
import { json, badRequest, setSessionCookie } from "./_auth";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");

  const { emailOrUsername, password } = body;
  if (!emailOrUsername || !password) return badRequest("Missing fields");

  const row = await env.DB.prepare(
    `SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1`
  )
    .bind(emailOrUsername.toLowerCase(), emailOrUsername)
    .first();

  if (!row) return json({ error: "Invalid credentials" }, { status: 401 });

  const ok = await verifyPassword(password, row.password_salt, row.password_hash);
  if (!ok) return json({ error: "Invalid credentials" }, { status: 401 });

  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  )
    .bind(sessionId, row.id, expires, now)
    .run();

  return json(
    { ok: true },
    { headers: { "Set-Cookie": setSessionCookie(sessionId, request) } }
  );
}
