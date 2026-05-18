import { json, requireAdmin } from "../../_auth.js";
import { runLastCallPost } from "../../../../worker/src/last-call-job.js";

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  if (!env.DISCORD_MOVIE_CHAT_WEBHOOK_URL) {
    return json({ error: "DISCORD_MOVIE_CHAT_WEBHOOK_URL not set" }, { status: 400 });
  }

  const result = await runLastCallPost(env);
  if (result.error) return json({ error: result.error }, { status: 502 });
  return json(result);
}
