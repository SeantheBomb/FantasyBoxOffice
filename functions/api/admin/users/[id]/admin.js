import { json, badRequest, requireAdmin, notFound } from "../../../_auth";

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.is_admin !== "boolean") return badRequest("is_admin boolean required");

  const target = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
    .bind(params.id).first();
  if (!target) return notFound();

  await env.DB.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`)
    .bind(body.is_admin ? 1 : 0, params.id).run();
  return json({ ok: true, is_admin: body.is_admin });
}
