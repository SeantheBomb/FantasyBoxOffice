import { json, requireUser } from "../_auth";
import { computeStandings } from "./_standings";

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;
  return json(await computeStandings(env.DB));
}
