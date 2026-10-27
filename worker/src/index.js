// Fantasy Box Office cron worker. Runs five scheduled jobs:
//   0 9 * * *     — refresh TMDB movies (budget/poster/release/status)
//   0 14 * * *    — scrape Box Office Mojo dailies for released movies
//   * * * * *     — settle expired auctions
//   30 14 * * MON — self-contained weekly standings post (backfill + score + post)
//   0 12 * * THU  — last-call betting reminder in #movie-chat (8 AM EDT)
//   (the every-minute tick also fires the Sat/Sun 22:00 UTC showdown halftime posts)
//
// Shares logic with the Pages Functions in ../../functions/api via relative imports.

import { refreshMovies, rollStatuses } from "../../functions/api/_tmdb.js";
import { refreshDailies, backfillDailies } from "../../functions/api/_boxoffice.js";
import { settleExpiredAuctions, markAndFindClosingSoonAuctions } from "../../functions/api/_settlement.js";
import { postAuctionSettled, postAuctionClosingSoon } from "../../functions/api/_discord.js";
import { bootstrapSchema } from "../../functions/api/_schema.js";
import { runStandingsPost } from "./standings-job.js";
import { runLastCallPost } from "./last-call-job.js";
import { runSeedPoolChunk } from "./seed-pool-job.js";
import { runShowdownSettlement, runShowdownHalftime } from "./showdown-job.js";
import { refundShowdownBetsForMovie } from "../../functions/api/_showdown.js";

const SEASON_FROM = "2026-01-01";
const SEASON_TO = "2026-12-31";

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    if (cron === "0 9 * * *") {
      ctx.waitUntil(runMoviesRefresh(env));
    } else if (cron === "0 14 * * *") {
      ctx.waitUntil(runDailiesRefresh(env));
    } else if (cron === "* * * * *") {
      ctx.waitUntil(runSettleExpired(env));
      const halftime = showdownHalftimeKind(new Date(event.scheduledTime));
      if (halftime) ctx.waitUntil(runShowdownHalftime(env, halftime));
    } else if (cron === "30 14 * * MON") {
      ctx.waitUntil(runStandingsPost(env));
    } else if (cron === "0 12 * * THU") {
      ctx.waitUntil(runLastCallPost(env));
    }
  },

  // Manual trigger: GET /trigger?job=movies|dailies|settle|standings|standings-full|lastcall|showdown-settle|showdown-halftime
  // HTTP-triggered ctx.waitUntil has a ~30s wall clock limit, so ?job=standings
  // runs in quick mode (skips BOM scraping). Use standings-full for the complete
  // flow (may time out on HTTP but works via cron's 15-min limit).
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/trigger") {
      return new Response("fbo-cron: use /trigger?job=...", { status: 200 });
    }
    const job = url.searchParams.get("job");
    if (job === "movies") {
      ctx.waitUntil(runMoviesRefresh(env));
    } else if (job === "dailies") {
      ctx.waitUntil(runDailiesRefresh(env));
    } else if (job === "settle") {
      ctx.waitUntil(runSettleExpired(env));
    } else if (job === "standings") {
      ctx.waitUntil(runStandingsPost(env, { quick: true }));
    } else if (job === "standings-full") {
      ctx.waitUntil(runStandingsPost(env));
    } else if (job === "lastcall") {
      ctx.waitUntil(runLastCallPost(env));
    } else if (job === "showdown-settle") {
      ctx.waitUntil(runShowdownSettlement(env, { fromDays: 10, toDays: 1 }));
    } else if (job === "showdown-halftime") {
      ctx.waitUntil(runShowdownHalftime(env, url.searchParams.get("kind") === "sunday" ? "sunday" : "halftime"));
    } else if (job === "backfill") {
      ctx.waitUntil(runBackfill(env));
    } else if (job === "seed-pool") {
      const year = parseInt(url.searchParams.get("year"), 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      if (!year) return new Response("year required", { status: 400 });
      const result = await runSeedPoolChunk(env, year, offset);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } else {
      return new Response("job must be movies|dailies|settle|standings|standings-full|lastcall|showdown-settle|showdown-halftime", { status: 400 });
    }
    return new Response(JSON.stringify({ started: job }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};

async function runMoviesRefresh(env) {
  if (!env.TMDB_TOKEN) return { error: "TMDB_TOKEN missing" };
  const upserted = await refreshMovies({
    db: env.DB,
    token: env.TMDB_TOKEN,
    from: SEASON_FROM,
    to: SEASON_TO,
  });
  await rollStatuses(env.DB);
  const delays = await checkWeekendMovieDelays(env);
  return { upserted, delays };
}

// After each TMDB refresh, find upcoming weekend_movies whose release_date has
// shifted more than 7 days past their scheduled weekend. Remove them and post
// an announcement so the league knows bets for that movie are cancelled.
async function checkWeekendMovieDelays(env) {
  const { results } = await env.DB.prepare(
    `SELECT wm.tmdb_id, wm.weekend_date, m.title, m.release_date
     FROM weekend_movies wm
     JOIN movies m ON m.tmdb_id = wm.tmdb_id
     WHERE wm.weekend_date > date('now')
       AND (m.release_date IS NULL OR m.release_date > date(wm.weekend_date, '+7 days'))`
  ).all();

  if (!results?.length) return [];

  const removed = [];
  for (const row of results) {
    const refunded = await refundShowdownBetsForMovie(env.DB, row.tmdb_id, row.weekend_date);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM weekend_picks WHERE tmdb_id = ? AND weekend_date = ?`).bind(row.tmdb_id, row.weekend_date),
      env.DB.prepare(`DELETE FROM weekend_movies WHERE tmdb_id = ? AND weekend_date = ?`).bind(row.tmdb_id, row.weekend_date),
    ]);

    if (env.DISCORD_WEBHOOK_URL) {
      const newDate = row.release_date
        ? new Date(row.release_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        : "TBD";
      await fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `📅 **${row.title}** has been removed from the **${row.weekend_date}** weekend lineup — its release date moved to **${newDate}**. Any picks for this movie have been cancelled.${refunded.length ? ` Showdown stakes on it (${refunded.length}) have been refunded.` : ""}`,
        }),
      }).catch(() => {});
    }

    console.log(`[movies] delay detected: ${row.title} removed from ${row.weekend_date} (new date: ${row.release_date})`);
    removed.push({ tmdb_id: row.tmdb_id, title: row.title, weekend_date: row.weekend_date, new_release_date: row.release_date });
  }

  return removed;
}

async function runDailiesRefresh(env) {
  if (!env.TMDB_TOKEN) return { error: "TMDB_TOKEN missing" };
  const dailies = await refreshDailies({ db: env.DB, token: env.TMDB_TOKEN });
  // Monday's standings job settles last weekend; this retries older showdowns
  // still waiting on BOM numbers.
  const showdowns = await runShowdownSettlement(env, { fromDays: 10, toDays: 4 });
  return { dailies, showdowns };
}

// Saturday and Sunday at 22:00 UTC, once BOM has posted the previous day.
function showdownHalftimeKind(t) {
  if (t.getUTCHours() !== 22 || t.getUTCMinutes() !== 0) return null;
  if (t.getUTCDay() === 6) return "halftime";
  if (t.getUTCDay() === 0) return "sunday";
  return null;
}

async function runSettleExpired(env) {
  await bootstrapSchema(env.DB);
  const result = await settleExpiredAuctions(env.DB);
  if (env.DISCORD_WEBHOOK_URL && result.settledAuctions?.length) {
    for (const a of result.settledAuctions) {
      await postAuctionSettled(env.DISCORD_WEBHOOK_URL, {
        movieTitle: a.movieTitle,
        posterUrl: a.posterUrl,
        releaseDate: a.releaseDate,
        winnerDiscordId: a.winnerDiscordId,
        winnerUsername: a.winnerUsername,
        amount: a.price,
      }).catch(() => {});
    }
  }
  const closing = await markAndFindClosingSoonAuctions(env.DB);
  if (env.DISCORD_WEBHOOK_URL && closing.length) {
    for (const a of closing) {
      await postAuctionClosingSoon(env.DISCORD_WEBHOOK_URL, a).catch(() => {});
    }
  }
  return result;
}

async function runBackfill(env) {
  if (!env.TMDB_TOKEN) return { error: "TMDB_TOKEN missing" };
  const result = await backfillDailies({ db: env.DB, token: env.TMDB_TOKEN });
  console.log("[backfill] done:", JSON.stringify(result));
  return result;
}
