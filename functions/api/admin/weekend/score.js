import { json, badRequest, requireAdmin } from "../../_auth.js";
import { postToWebhook } from "../../_discord.js";
import { formatShort } from "../../_format.js";

const POINTS = [3, 2, 1];
const MEDALS = ["🥇", "🥈", "🥉"];

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const weekendDate = new URL(request.url).searchParams.get("weekend_date");
  const query = weekendDate
    ? `SELECT wp.discord_username, wp.tmdb_id, m.title, wp.estimate, wp.points_awarded, wp.weekend_date
       FROM weekend_picks wp JOIN movies m ON m.tmdb_id = wp.tmdb_id
       WHERE wp.weekend_date = ? ORDER BY m.title, wp.estimate DESC`
    : `SELECT wp.discord_username, wp.tmdb_id, m.title, wp.estimate, wp.points_awarded, wp.weekend_date
       FROM weekend_picks wp JOIN movies m ON m.tmdb_id = wp.tmdb_id
       WHERE wp.weekend_date >= date('now', '-3 days') ORDER BY wp.weekend_date, m.title, wp.estimate DESC`;

  const { results } = weekendDate
    ? await env.DB.prepare(query).bind(weekendDate).all()
    : await env.DB.prepare(query).all();

  return json({ picks: results });
}

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.weekend_date || !body?.tmdb_id || body.actual_gross == null) {
    return badRequest("weekend_date, tmdb_id, and actual_gross required");
  }

  const { weekend_date, tmdb_id, actual_gross } = body;

  await env.DB.prepare(
    `INSERT INTO weekend_results (tmdb_id, weekend_date, actual_gross)
     VALUES (?, ?, ?)
     ON CONFLICT(tmdb_id, weekend_date) DO UPDATE SET actual_gross = excluded.actual_gross, scored_at = datetime('now')`
  )
    .bind(tmdb_id, weekend_date, actual_gross)
    .run();

  const movie = await env.DB.prepare(`SELECT title FROM movies WHERE tmdb_id = ?`)
    .bind(tmdb_id)
    .first();

  const { results: picks } = await env.DB.prepare(
    `SELECT discord_user_id, discord_username, estimate FROM weekend_picks
     WHERE tmdb_id = ? AND weekend_date = ?
     ORDER BY ABS(estimate - ?) ASC`
  )
    .bind(tmdb_id, weekend_date, actual_gross)
    .all();

  if (picks.length === 0) {
    return json({ ok: true, message: "No picks to score.", picks: [] });
  }

  const scored = picks.map((p, i) => ({
    ...p,
    diff: Math.abs(p.estimate - actual_gross),
    points: POINTS[i] ?? 0,
  }));

  const updateStmts = scored.map((p) =>
    env.DB.prepare(
      `UPDATE weekend_picks SET points_awarded = ?
       WHERE discord_user_id = ? AND tmdb_id = ? AND weekend_date = ?`
    ).bind(p.points, p.discord_user_id, tmdb_id, weekend_date)
  );
  await env.DB.batch(updateStmts);

  const lines = scored.map((p, i) => {
    const medal = MEDALS[i] ?? "  ";
    return `${medal} **${p.discord_username}** — guessed ${formatShort(p.estimate)} *(off by ${formatShort(p.diff)})* → **+${p.points} pts**`;
  });
  const content = `## 🎬 ${movie?.title ?? `Movie #${tmdb_id}`} — Opening Weekend Results\nActual: **${formatShort(actual_gross)}**\n\n${lines.join("\n")}`;

  if (env.DISCORD_WEBHOOK_URL) {
    await postToWebhook(env.DISCORD_WEBHOOK_URL, { messages: [content] });
  }

  return json({ ok: true, movie: movie?.title, actual_gross, scored });
}
