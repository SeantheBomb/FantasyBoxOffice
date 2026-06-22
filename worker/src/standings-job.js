// Self-contained Monday standings job. Produces all the data it needs
// (backfill + daily refresh) before consuming it (scoring + standings),
// eliminating timing dependencies on other crons.

import { computeStandings } from "../../functions/api/game/_standings.js";
import { computeHistory } from "../../functions/api/game/_history.js";
import { backfillDailies, refreshDailies } from "../../functions/api/_boxoffice.js";
import { refreshNewReleaseBudgets } from "../../functions/api/_tmdb.js";
import {
  buildStandingsMarkdown,
  buildChartConfig,
  renderChartPng,
  postToWebhook,
  postWeekendAnnouncement,
} from "../../functions/api/_discord.js";
import { scoreMovie } from "../../functions/api/_weekend-scoring.js";

// { quick: true } skips the slow BOM scraping steps (backfill + dailies
// refresh). Use for manual HTTP triggers where ctx.waitUntil has a 30-second
// wall clock limit. The Monday cron always runs the full flow.
export async function runStandingsPost(env, { quick = false } = {}) {
  const t0 = Date.now();

  if (!env.DISCORD_WEBHOOK_URL) {
    console.error("[standings] DISCORD_WEBHOOK_URL missing — aborting");
    return { error: "DISCORD_WEBHOOK_URL missing" };
  }

  console.log(`[standings] starting (quick=${quick})`);

  // ── Step 1: Backfill BOM weekly history ──────────────────────────────
  // Fetches the weekly release chart for every tracked movie so we have
  // accurate opening weekend gross data for scoring.
  let backfillResult = null;
  let backfillMs = 0;
  if (quick) {
    backfillResult = { skipped: "quick mode" };
  } else if (env.TMDB_TOKEN) {
    const bt = Date.now();
    try {
      backfillResult = await backfillDailies({ db: env.DB, token: env.TMDB_TOKEN });
      console.log("[standings] backfill done:", JSON.stringify(backfillResult));
    } catch (e) {
      backfillResult = { error: e.message || String(e) };
      console.error("[standings] backfill error:", backfillResult.error);
    }
    backfillMs = Date.now() - bt;
  } else {
    backfillResult = { skipped: "TMDB_TOKEN missing" };
    console.warn("[standings] backfill skipped: TMDB_TOKEN missing");
  }

  // ── Step 2: Refresh today's daily snapshot ───────────────────────────
  // Gets the current cumulative BOM total for each movie. Running this
  // inline eliminates the race with the 14:00 daily cron.
  let dailiesResult = null;
  let dailiesMs = 0;
  if (quick) {
    dailiesResult = { skipped: "quick mode" };
  } else if (env.TMDB_TOKEN) {
    const dt = Date.now();
    try {
      dailiesResult = await refreshDailies({ db: env.DB, token: env.TMDB_TOKEN });
      console.log("[standings] dailies refresh done:", JSON.stringify(dailiesResult));
    } catch (e) {
      dailiesResult = { error: e.message || String(e) };
      console.error("[standings] dailies refresh error:", dailiesResult.error);
    }
    dailiesMs = Date.now() - dt;
  } else {
    dailiesResult = { skipped: "TMDB_TOKEN missing" };
  }

  // ── Step 3: Score last weekend's predictions ─────────────────────────
  const st = Date.now();
  const scoringResult = await autoScoreWeekendPicks(env);
  const scoringMs = Date.now() - st;
  console.log("[standings] scoring done:", JSON.stringify(scoringResult));

  // ── Step 4: Refresh budgets for new releases ─────────────────────────
  let budgetResult = null;
  if (env.TMDB_TOKEN) {
    try {
      budgetResult = await refreshNewReleaseBudgets({ db: env.DB, token: env.TMDB_TOKEN });
    } catch (e) {
      budgetResult = { error: e.message || String(e) };
    }
  }

  // ── Step 5: Compute standings + post to Discord ──────────────────────
  let standingsPosted = false;
  let standingsError = null;
  let pngBytes = null;
  let chartError = null;
  let standingsUsers = 0;
  let standingsMessages = 0;
  let standingsMs = 0;
  {
    const stt = Date.now();
    try {
      const [standings, history] = await Promise.all([
        computeStandings(env.DB),
        computeHistory(env.DB, { season: "2026" }),
      ]);

      standingsUsers = standings.users.length;
      const messages = buildStandingsMarkdown(standings);
      standingsMessages = messages.length;
      const config = buildChartConfig(history);

      try {
        pngBytes = await renderChartPng(config);
      } catch (e) {
        chartError = e.message || String(e);
        console.error("[standings] chart render error:", chartError);
      }

      await postToWebhook(env.DISCORD_WEBHOOK_URL, { messages, pngBytes });
      standingsPosted = true;
      console.log(`[standings] standings posted (${standingsMessages} msgs, chart ${pngBytes ? pngBytes.length : 0} bytes)`);
    } catch (e) {
      standingsError = e.message || String(e);
      console.error("[standings] standings post error:", standingsError);
    }
    standingsMs = Date.now() - stt;
  }

  // ── Step 6: Post next-weekend announcement ───────────────────────────
  let announcementResult = null;
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
      await postWeekendAnnouncement(env.DISCORD_WEBHOOK_URL, {
        weekendDate: weekendMovies[0].weekend_date,
        movies: weekendMovies,
      });
      announcementResult = { posted: true, movies: weekendMovies.length };
      console.log(`[standings] announcement posted (${weekendMovies.length} movies, ${weekendMovies[0].weekend_date})`);
    } else {
      announcementResult = { skipped: "no upcoming weekend movies configured" };
      console.warn("[standings] announcement skipped: no upcoming weekend movies configured");
    }
  } catch (e) {
    announcementResult = { error: e.message || String(e) };
    console.error("[standings] announcement error:", announcementResult.error);
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const totalMs = Date.now() - t0;
  const summary = {
    ok: standingsPosted,
    duration_ms: totalMs,
    backfill_ms: backfillMs,
    dailies_ms: dailiesMs,
    scoring_ms: scoringMs,
    standings_ms: standingsMs,
    standings_error: standingsError,
    chart_error: chartError,
    announcement: announcementResult,
    scoring: scoringResult,
  };
  console.log("[standings] DONE", JSON.stringify(summary));

  return {
    posted: standingsPosted,
    standings_error: standingsError,
    users: standingsUsers,
    messages: standingsMessages,
    chart_bytes: pngBytes ? pngBytes.length : 0,
    chart_error: chartError,
    backfill: backfillResult,
    dailies: dailiesResult,
    budgets: budgetResult,
    announcement: announcementResult,
    scoring: scoringResult,
  };
}

async function autoScoreWeekendPicks(env) {
  if (!env.DISCORD_WEBHOOK_URL) return { skipped: "DISCORD_WEBHOOK_URL missing" };

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
    const daily = await env.DB.prepare(
      `SELECT domestic_revenue FROM dailies
       WHERE tmdb_id = ? AND date BETWEEN ? AND date(?, '+3 days')
       ORDER BY date DESC LIMIT 1`
    )
      .bind(movie.tmdb_id, movie.weekend_date, movie.weekend_date)
      .first();

    if (!daily?.domestic_revenue) {
      results.push({ tmdb_id: movie.tmdb_id, title: movie.title, scored: false, discord_posted: false, error: "no BOM data yet" });
      continue;
    }

    const actual_gross = Math.round(daily.domestic_revenue / 1_000_000) * 1_000_000;

    // Score in DB first — this is the critical operation.
    let scoreResult;
    try {
      scoreResult = await scoreMovie(env.DB, {
        tmdb_id: movie.tmdb_id,
        weekend_date: movie.weekend_date,
        actual_gross,
      });
    } catch (e) {
      results.push({ tmdb_id: movie.tmdb_id, title: movie.title, scored: false, discord_posted: false, error: e.message || String(e) });
      continue;
    }

    // Post to Discord separately — a webhook failure shouldn't mask a successful score.
    let discordPosted = false;
    try {
      const res = await fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: scoreResult.content }),
      });
      if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      discordPosted = true;
    } catch (e) {
      console.error(`[standings] scoring Discord post failed for ${movie.title}:`, e.message || String(e));
    }

    results.push({ tmdb_id: movie.tmdb_id, title: movie.title, actual_gross, scored: true, discord_posted: discordPosted });
  }

  return { results };
}
