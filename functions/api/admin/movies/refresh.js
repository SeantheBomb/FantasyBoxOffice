import { json, badRequest, requireAdmin } from "../../_auth";
import { refreshMovies, rollStatuses } from "../../_tmdb";

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;
  if (!env.TMDB_TOKEN) return badRequest("TMDB_TOKEN missing");

  const body = await request.json().catch(() => ({}));
  const from = body.from || "2026-01-01";
  const to = body.to || "2026-12-31";
  const minPopularity = body.minPopularity ?? 0;

  const result = await refreshMovies({ db: env.DB, token: env.TMDB_TOKEN, from, to, minPopularity });
  await rollStatuses(env.DB);
  return json({ ok: true, ...result });
}
