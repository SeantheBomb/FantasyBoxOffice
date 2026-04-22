export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

export function badRequest(message) {
  return json({ error: message }, { status: 400 });
}

export function unauthorized(message = "Not signed in") {
  return json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return json({ error: message }, { status: 403 });
}

export function notFound(message = "Not found") {
  return json({ error: message }, { status: 404 });
}

export function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

export function setSessionCookie(sessionId, request) {
  const url = new URL(request.url);
  const isHttps = url.protocol === "https:";

  // Only set Secure when HTTPS (production on Pages).
  const securePart = isHttps ? " Secure;" : "";

  return `session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly;${securePart} SameSite=Lax; Max-Age=604800`;
}

export async function getSessionUser(request, env) {
  const sessionId = getCookie(request, "session");
  if (!sessionId) return null;

  const s = await env.DB.prepare(
    `SELECT user_id, expires_at FROM sessions WHERE id = ? LIMIT 1`
  )
    .bind(sessionId)
    .first();

  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) return null;

  const u = await env.DB.prepare(
    `SELECT id, email, username, real_name, created_at, is_admin, points_remaining
       FROM users WHERE id = ? LIMIT 1`
  )
    .bind(s.user_id)
    .first();

  return u || null;
}

export async function requireUser(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return { user: null, response: unauthorized() };
  return { user, response: null };
}

export async function requireAdmin(request, env) {
  const { user, response } = await requireUser(request, env);
  if (!user) return { user: null, response };
  if (!user.is_admin) return { user, response: forbidden("Admin only") };
  return { user, response: null };
}
