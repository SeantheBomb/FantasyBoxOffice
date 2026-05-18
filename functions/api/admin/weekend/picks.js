import { json, badRequest, requireAdmin } from "../../_auth.js";

// PATCH — update a pick's estimate by id
export async function onRequestPatch({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.id || body.estimate == null) return badRequest("id and estimate required");

  const estimate = Number(body.estimate);
  if (!Number.isInteger(estimate) || estimate <= 0) return badRequest("estimate must be a positive integer");

  const result = await env.DB.prepare(
    `UPDATE weekend_picks SET estimate = ? WHERE id = ?`
  )
    .bind(estimate, body.id)
    .run();

  if (!result.meta.changes) return json({ error: "Pick not found" }, { status: 404 });
  return json({ ok: true });
}

// DELETE — remove a pick by id
export async function onRequestDelete({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.id) return badRequest("id required");

  const result = await env.DB.prepare(`DELETE FROM weekend_picks WHERE id = ?`)
    .bind(body.id)
    .run();

  if (!result.meta.changes) return json({ error: "Pick not found" }, { status: 404 });
  return json({ ok: true });
}

// POST — manually create a pick (admin entry on behalf of a player)
export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.discord_user_id || !body?.tmdb_id || !body?.weekend_date || body.estimate == null) {
    return badRequest("discord_user_id, tmdb_id, weekend_date, and estimate required");
  }

  const estimate = Number(body.estimate);
  if (!Number.isInteger(estimate) || estimate <= 0) return badRequest("estimate must be a positive integer");

  const appUser = await env.DB.prepare(
    `SELECT username FROM users WHERE discord_user_id = ?`
  )
    .bind(body.discord_user_id)
    .first();

  await env.DB.prepare(
    `INSERT INTO weekend_picks (discord_user_id, discord_username, tmdb_id, estimate, weekend_date)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(discord_user_id, tmdb_id, weekend_date)
     DO UPDATE SET estimate = excluded.estimate`
  )
    .bind(
      body.discord_user_id,
      appUser?.username ?? body.discord_user_id,
      body.tmdb_id,
      estimate,
      body.weekend_date
    )
    .run();

  return json({ ok: true });
}
