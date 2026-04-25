import { json, badRequest, requireAdmin } from "../../_auth";
import { backfillDailies } from "../../_boxoffice";

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;
  if (!env.TMDB_TOKEN) return badRequest("TMDB_TOKEN missing");

  const result = await backfillDailies({ db: env.DB, token: env.TMDB_TOKEN });
  return json({ ok: true, ...result });
}
