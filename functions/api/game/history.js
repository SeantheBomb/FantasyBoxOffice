import { json, requireUser } from "../_auth";
import { computeHistory } from "./_history";

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;

  const url = new URL(request.url);
  const season = url.searchParams.get("season") || "2026";
  return json(await computeHistory(env.DB, { season }));
}
