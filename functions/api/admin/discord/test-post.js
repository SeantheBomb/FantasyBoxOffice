import { json, requireAdmin } from "../../_auth";
import { computeStandings } from "../../game/_standings";
import { computeHistory } from "../../game/_history";
import {
  buildStandingsMarkdown,
  buildChartConfig,
  renderChartPng,
  postToWebhook,
} from "../../_discord";

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  if (!env.DISCORD_WEBHOOK_URL) {
    return json({ error: "DISCORD_WEBHOOK_URL not set in Pages environment" }, { status: 400 });
  }

  const [standings, history] = await Promise.all([
    computeStandings(env.DB),
    computeHistory(env.DB, { season: "2026" }),
  ]);

  const messages = buildStandingsMarkdown(standings);
  const config = buildChartConfig(history);

  let pngBytes = null;
  let chartError = null;
  try {
    pngBytes = await renderChartPng(config);
  } catch (e) {
    chartError = e.message || String(e);
  }

  try {
    await postToWebhook(env.DISCORD_WEBHOOK_URL, { messages, pngBytes });
  } catch (e) {
    return json({ error: `Webhook failed: ${e.message || e}` }, { status: 502 });
  }

  return json({
    ok: true,
    users: standings.users.length,
    messages: messages.length,
    chart_bytes: pngBytes ? pngBytes.length : 0,
    chart_error: chartError,
    preview: messages[0].slice(0, 400),
  });
}
