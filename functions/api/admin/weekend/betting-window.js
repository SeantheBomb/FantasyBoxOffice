import { json, badRequest, requireAdmin } from "../../_auth.js";
import { getBettingWindow } from "../../_betting.js";

// POST — set (closes_at ISO) or clear (closes_at null) a weekend's betting close override
export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body?.weekend_date ?? "")) return badRequest("weekend_date (YYYY-MM-DD) required");
  if (body.closes_at != null && Number.isNaN(Date.parse(body.closes_at))) return badRequest("closes_at must be an ISO timestamp or null");

  // getBettingWindow bootstraps the table, so call it before writing.
  await getBettingWindow(env.DB, body.weekend_date);
  if (body.closes_at == null) {
    await env.DB.prepare(`DELETE FROM weekend_betting_windows WHERE weekend_date = ?`)
      .bind(body.weekend_date)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO weekend_betting_windows (weekend_date, closes_at) VALUES (?, ?)
       ON CONFLICT(weekend_date) DO UPDATE SET closes_at = excluded.closes_at, updated_at = datetime('now')`
    )
      .bind(body.weekend_date, new Date(body.closes_at).toISOString())
      .run();
  }

  const window = await getBettingWindow(env.DB, body.weekend_date);
  const closesMs = Date.parse(window.closes_at);

  let posted = false;
  if (body.notify !== false && env.DISCORD_WEBHOOK_URL && closesMs > Date.now()) {
    const unix = Math.floor(closesMs / 1000);
    const res = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `⏰ Betting for the **${body.weekend_date}** weekend is open until <t:${unix}:F> (<t:${unix}:R>). Use \`/bet\` to lock in your picks!`,
      }),
    }).catch(() => null);
    posted = !!res?.ok;
  }

  return json({ ok: true, betting: window, posted });
}
