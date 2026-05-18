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
import { scoreMovie } from "../../functions/api/_weekend-scoring.js";

export async function runStandingsPost(env) {
  if (!env.DISCORD_WEBHOOK_URL) return { error: "DISCORD_WEBHOOK_URL missing" };

  // Auto-score last weekend's picks before posting standings.
  const scoringResult = await autoScoreWeekendPicks(env);

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
    scoring: scoringResult,
  };
}

async function autoScoreWeekendPicks(env) {
  if (!env.DISCORD_GAME_FEED_WEBHOOK_URL) return { skipped: "DISCORD_GAME_FEED_WEBHOOK_URL missing" };

  // Find movies from last weekend that haven't been scored yet.
  // On Monday, 'now - 3 days' = Friday, catching last weekend's lineup.
  const { results: unscored } = await env.DB.prepare(
    `SELECT wm.tmdb_id, wm.weekend_date, m.title
     FROM weekend_movies wm
     JOIN movies m ON m.tmdb_id = wm.tmdb_id
     WHERE wm.weekend_date < date('now')
       AND wm.weekend_date >= date('now', '-3 days')
       AND NOT EXISTS (
         SELECT 1 FROM weekend_results wr
         WHERE wr.tmdb_id = wm.tmdb_id AND wr.weekend_date = wm.weekend_date
       )
     ORDER BY wm.weekend_date, m.title`
  ).all();

  if (!unscored.length) return { skipped: "no unscored movies from last weekend" };

  const results = [];
  for (const movie of unscored) {
    // Opening weekend gross = first dailies entry in the week after release.
    // backfillDailies (run above) populates this from BOM's weekly release chart.
    const daily = await env.DB.prepare(
      `SELECT domestic_revenue FROM dailies
       WHERE tmdb_id = ? AND date BETWEEN ? AND date(?, '+7 days')
       ORDER BY date ASC LIMIT 1`
    )
      .bind(movie.tmdb_id, movie.weekend_date, movie.weekend_date)
      .first();

    if (!daily?.domestic_revenue) {
      results.push({ tmdb_id: movie.tmdb_id, title: movie.title, error: "no BOM data yet — score manually" });
      continue;
    }

    try {
      const result = await scoreMovie(env.DB, {
        tmdb_id: movie.tmdb_id,
        weekend_date: movie.weekend_date,
        actual_gross: daily.domestic_revenue,
      });

      await fetch(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: result.content }),
      });

      results.push({ tmdb_id: movie.tmdb_id, title: movie.title, actual_gross: daily.domestic_revenue });
    } catch (e) {
      results.push({ tmdb_id: movie.tmdb_id, title: movie.title, error: e.message || String(e) });
    }
  }

  return { results };
}
