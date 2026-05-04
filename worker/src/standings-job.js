// Weekly Discord post: backfills the full weekly BOM history for all tracked
// movies, then compiles standings + history, renders the profit chart via
// QuickChart, and posts to the configured Discord webhook.

import { computeStandings } from "../../functions/api/game/_standings.js";
import { computeHistory } from "../../functions/api/game/_history.js";
import { backfillDailies } from "../../functions/api/_boxoffice.js";
import {
  buildStandingsMarkdown,
  buildChartConfig,
  renderChartPng,
  postToWebhook,
} from "../../functions/api/_discord.js";

export async function runStandingsPost(env) {
  if (!env.DISCORD_WEBHOOK_URL) return { error: "DISCORD_WEBHOOK_URL missing" };

  // Backfill the full weekly BOM history for all tracked movies before
  // computing standings. Unlike refreshDailies (today-only snapshot),
  // backfillDailies scrapes BOM's cumulative weekly release tables and fills
  // in every week's total — so even if the daily cron missed days, the chart
  // and standings will reflect complete data. Tolerant of failures: a scraper
  // hiccup shouldn't block the Discord post.
  let dailiesResult = null;
  if (env.TMDB_TOKEN) {
    try {
      dailiesResult = await backfillDailies({ db: env.DB, token: env.TMDB_TOKEN });
    } catch (e) {
      dailiesResult = { error: e.message || String(e) };
    }
  } else {
    dailiesResult = { skipped: "TMDB_TOKEN missing" };
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

  await postToWebhook(env.DISCORD_WEBHOOK_URL, { messages, pngBytes });

  return {
    posted: true,
    users: standings.users.length,
    messages: messages.length,
    chart_bytes: pngBytes ? pngBytes.length : 0,
    chart_error: chartError,
    dailies: dailiesResult,
  };
}
