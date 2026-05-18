// Weekly Discord post: backfills the full weekly BOM history for all tracked
// movies, then compiles standings + history, renders the profit chart via
// QuickChart, and posts to the configured Discord webhook.

import { computeStandings } from "../../functions/api/game/_standings.js";
import { computeHistory } from "../../functions/api/game/_history.js";
import { backfillDailies } from "../../functions/api/_boxoffice.js";
import { refreshNewReleaseBudgets } from "../../functions/api/_tmdb.js";
import {
  buildStandingsMarkdown,
  buildChartConfig,
  renderChartPng,
  postToWebhook,
  postWeekendAnnouncement,
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

  // Refresh production budgets for movies that opened this past weekend so
  // their profit line uses the most current TMDB figure.
  let budgetResult = null;
  if (env.TMDB_TOKEN) {
    try {
      budgetResult = await refreshNewReleaseBudgets({ db: env.DB, token: env.TMDB_TOKEN });
    } catch (e) {
      budgetResult = { error: e.message || String(e) };
    }
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

  let announcementResult = null;
  if (env.DISCORD_MOVIE_CHAT_WEBHOOK_URL) {
    try {
      const { results: weekendMovies } = await env.DB.prepare(
        `SELECT m.tmdb_id, m.title, m.poster_url, u.username AS owner, wm.weekend_date
         FROM weekend_movies wm
         JOIN movies m ON m.tmdb_id = wm.tmdb_id
         JOIN owned_movies om ON om.tmdb_id = wm.tmdb_id AND om.is_void = 0
         JOIN users u ON u.id = om.owner_user_id
         WHERE wm.weekend_date >= date('now')
         ORDER BY m.title`
      ).all();
      if (weekendMovies.length) {
        await postWeekendAnnouncement(env.DISCORD_MOVIE_CHAT_WEBHOOK_URL, {
          weekendDate: weekendMovies[0].weekend_date,
          movies: weekendMovies,
        });
        announcementResult = { posted: true, movies: weekendMovies.length };
      } else {
        announcementResult = { skipped: "no upcoming weekend movies configured" };
      }
    } catch (e) {
      announcementResult = { error: e.message || String(e) };
    }
  }

  return {
    posted: true,
    users: standings.users.length,
    messages: messages.length,
    chart_bytes: pngBytes ? pngBytes.length : 0,
    chart_error: chartError,
    dailies: dailiesResult,
    budgets: budgetResult,
    announcement: announcementResult,
  };
}
