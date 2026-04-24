import { json, badRequest, requireAdmin, notFound } from "../../../_auth";

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.in_league !== "boolean") return badRequest("in_league boolean required");

  const target = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
    .bind(params.id).first();
  if (!target) return notFound();

  await env.DB.prepare(`UPDATE users SET in_league = ? WHERE id = ?`)
    .bind(body.in_league ? 1 : 0, params.id).run();
  return json({ ok: true, in_league: body.in_league });
}
