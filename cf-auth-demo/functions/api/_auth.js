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

