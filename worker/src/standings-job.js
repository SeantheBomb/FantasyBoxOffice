// Weekly Discord post: compiles standings + history, renders the profit
// chart via QuickChart, posts to the configured Discord webhook.

import { computeStandings } from "../../functions/api/game/_standings.js";
import { computeHistory } from "../../functions/api/game/_history.js";
import {
  buildStandingsMarkdown,
  buildChartConfig,
  renderChartPng,
  postToWebhook,
} from "../../functions/api/_discord.js";

export async function runStandingsPost(env) {
  if (!env.DISCORD_WEBHOOK_URL) return { error: "DISCORD_WEBHOOK_URL missing" };

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

  await postToWebhook(env.DISCORD_WEBHOOK_URL, { messages, pngBytes });

  return {
    posted: true,
    users: standings.users.length,
    messages: messages.length,
    chart_bytes: pngBytes ? pngBytes.length : 0,
    chart_error: chartError,
  };
}
