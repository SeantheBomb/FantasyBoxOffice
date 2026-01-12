async function readJson(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, data, raw: text };
}

export async function apiSignup({ email, username, realName, password }) {
  const res = await fetch("/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // IMPORTANT: sends/receives cookies
    body: JSON.stringify({ email, username, realName, password }),
  });
  return readJson(res);
}

export async function apiLogin({ emailOrUsername, password }) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ emailOrUsername, password }),
  });
  return readJson(res);
}

export async function apiMe() {
  const res = await fetch("/api/me", {
    method: "GET",
    credentials: "include",
  });
  return readJson(res);
}
