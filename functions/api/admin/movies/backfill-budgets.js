import { json, badRequest, requireAdmin } from "../../_auth";
import { backfillBudgets } from "../../_tmdb";

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;
  if (!env.TMDB_TOKEN) return badRequest("TMDB_TOKEN missing");

  const body = await request.json().catch(() => ({}));
  const limit = body.limit ?? 40;

  const result = await backfillBudgets({ db: env.DB, token: env.TMDB_TOKEN, limit });
  return json({ ok: true, ...result });
}
