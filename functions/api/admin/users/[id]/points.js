import { json, badRequest, requireAdmin, notFound } from "../../../_auth";

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");
  const delta = Number(body.delta);
  if (!Number.isInteger(delta)) return badRequest("delta must be an integer");

  const target = await env.DB.prepare(
    `SELECT id, points_remaining FROM users WHERE id = ?`
  ).bind(params.id).first();
  if (!target) return notFound();

  await env.DB.prepare(
    `UPDATE users SET points_remaining = points_remaining + ? WHERE id = ?`
  ).bind(delta, params.id).run();

  const refreshed = await env.DB.prepare(
    `SELECT points_remaining FROM users WHERE id = ?`
  ).bind(params.id).first();

  return json({ ok: true, points_remaining: refreshed.points_remaining });
}
