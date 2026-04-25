import { json, requireUser } from "../../_auth";
import { settleAuction } from "../../_settlement";

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (!user) return response;
  const result = await settleAuction(env.DB, params.id);
  return json(result);
}
