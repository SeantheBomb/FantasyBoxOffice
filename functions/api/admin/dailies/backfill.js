import { json, badRequest, requireAdmin } from "../../_auth";

// Backfill runs as a long-running job in the cron Worker (which has a much
// higher subrequest limit than Pages Functions). We fire the trigger and
// return immediately — check Worker logs for results.
export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const workerUrl = env.CRON_WORKER_URL;
  if (!workerUrl) return badRequest("CRON_WORKER_URL env var not set");

  const res = await fetch(`${workerUrl}/trigger?job=backfill`, {
    method: "GET",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    return json({ ok: false, error: `Worker trigger failed: ${text}` }, 502);
  }

  return json({ ok: true, status: "started", note: "Backfill running in cron Worker — check worker logs for results" });
}
