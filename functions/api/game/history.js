import { json } from "../_auth";
import { computeHistory } from "./_history";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const season = url.searchParams.get("season") || "2026";
  return json(await computeHistory(env.DB, { season }));
}
