// Fantasy Box Office cron worker. Runs five scheduled jobs:
//   0 9 * * *     — refresh TMDB movies (budget/poster/release/status)
//   0 14 * * *    — scrape Box Office Mojo dailies for released movies
//   * * * * *     — settle expired auctions
//   30 14 * * MON — self-contained weekly standings post (backfill + score + post)
//   0 12 * * THU  — last-call betting reminder in #movie-chat (8 AM EDT)
//
// Shares logic with the Pages Functions in ../../functions/api via relative imports.

import { refreshMovies, rollStatuses } from "../../functions/api/_tmdb.js";
import { refreshDailies } from "../../functions/api/_boxoffice.js";
import { settleExpiredAuctions, markAndFindClosingSoonAuctions } from "../../functions/api/_settlement.js";
import { postAuctionSettled, postAuctionClosingSoon } from "../../functions/api/_discord.js";
import { bootstrapSchema } from "../../functions/api/_schema.js";
import { runStandingsPost } from "./standings-job.js";
import { runLastCallPost } from "./last-call-job.js";

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
    } else if (cron === "30 14 * * MON") {
      ctx.waitUntil(runStandingsPost(env));
    } else if (cron === "0 12 * * THU") {
      ctx.waitUntil(runLastCallPost(env));
    }
  },

  // Manual trigger: GET /trigger?job=movies|dailies|settle|standings|standings-full|lastcall
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
    } else {
      return new Response("job must be movies|dailies|settle|standings|standings-full|lastcall", { status: 400 });
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
  return { upserted };
}

async function runDailiesRefresh(env) {
  if (!env.TMDB_TOKEN) return { error: "TMDB_TOKEN missing" };
  return refreshDailies({ db: env.DB, token: env.TMDB_TOKEN });
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
