import { json, badRequest, getCookie } from "../_auth.js";

export async function onRequestPost({ request, env }) {
  // Need discord_user_id and in_league — fetch via session directly
  const sessionId = getCookie(request, "session");
  if (!sessionId) return json({ error: "Not signed in" }, { status: 401 });

  const s = await env.DB.prepare(
    `SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now') LIMIT 1`
  ).bind(sessionId).first();
  if (!s) return json({ error: "Not signed in" }, { status: 401 });

  const user = await env.DB.prepare(
    `SELECT id, username, discord_user_id, in_league FROM users WHERE id = ? LIMIT 1`
  ).bind(s.user_id).first();
  if (!user) return json({ error: "Not signed in" }, { status: 401 });

  if (!user.in_league) return json({ error: "You must be in the league to bet" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.tmdb_id || body.estimate == null) return badRequest("tmdb_id and estimate required");

  const estimate = Number(body.estimate);
  if (!Number.isInteger(estimate) || estimate <= 0) return badRequest("estimate must be a positive integer (millions)");

  const today = new Date().toISOString().slice(0, 10);

  // Movie must be in an upcoming weekend's lineup
  const weekend = await env.DB.prepare(
    `SELECT weekend_date FROM weekend_movies WHERE weekend_date > ? AND tmdb_id = ? LIMIT 1`
  ).bind(today, body.tmdb_id).first();
  if (!weekend) return json({ error: "Betting is closed — this movie is already in theaters or not in the lineup" }, { status: 400 });

  const weekendDate = weekend.weekend_date;
  const discordId = user.discord_user_id ?? "fbo_" + user.id;

  // No double-betting
  const existing = await env.DB.prepare(
    `SELECT id FROM weekend_picks WHERE discord_user_id = ? AND tmdb_id = ? AND weekend_date = ?`
  ).bind(discordId, body.tmdb_id, weekendDate).first();
  if (existing) return json({ error: "You already placed a bet on this movie" }, { status: 400 });

  // No duplicate estimates — check both formats since older Discord picks may be stored as raw dollars.
  const dup = await env.DB.prepare(
    `SELECT discord_username FROM weekend_picks
     WHERE tmdb_id = ? AND weekend_date = ?
       AND (estimate = ? OR estimate = ?)
       AND discord_user_id != ? LIMIT 1`
  ).bind(body.tmdb_id, weekendDate, estimate, estimate * 1_000_000, discordId).first();
  if (dup) return json({ error: `${dup.discord_username} already bet $${estimate}M — pick a different amount` }, { status: 400 });

  await env.DB.prepare(
    `INSERT INTO weekend_picks (discord_user_id, discord_username, tmdb_id, estimate, weekend_date)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(discordId, user.username, body.tmdb_id, estimate, weekendDate).run();

  // Post to Discord if user has a linked Discord account
  if (user.discord_user_id && env.DISCORD_WEBHOOK_URL) {
    const movie = await env.DB.prepare(`SELECT title FROM movies WHERE tmdb_id = ?`)
      .bind(body.tmdb_id).first();
    const content = `🎲 <@${user.discord_user_id}> bet **$${estimate}M** on **${movie?.title ?? "Unknown"}**`;
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).catch(() => {});
  }

  return json({ ok: true, estimate, weekend_date: weekendDate });
}
