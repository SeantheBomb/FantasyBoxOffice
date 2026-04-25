// Weekly Discord post: refreshes today's dailies, then compiles standings +
// history, renders the profit chart via QuickChart, and posts to the configured
// Discord webhook.

import { computeStandings } from "../../functions/api/game/_standings.js";
import { computeHistory } from "../../functions/api/game/_history.js";
import { refreshDailies } from "../../functions/api/_boxoffice.js";
import {
  buildStandingsMarkdown,
  buildChartConfig,
  renderChartPng,
  postToWebhook,
} from "../../functions/api/_discord.js";

export async function runStandingsPost(env) {
  if (!env.DISCORD_WEBHOOK_URL) return { error: "DISCORD_WEBHOOK_URL missing" };

  // Pull the freshest BOM numbers before snapshotting the standings — the
  // daily-refresh cron fires at the same minute and there's no ordering
  // guarantee, so we run it inline here. refreshDailies is idempotent
  // (skips movies already scraped today), so the parallel daily run will
  // be a no-op if this finishes first. Tolerant of failures: a scraper
  // hiccup shouldn't block the Monday post.
  let dailiesResult = null;
  if (env.TMDB_TOKEN) {
    try {
      dailiesResult = await refreshDailies({ db: env.DB, token: env.TMDB_TOKEN });
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
