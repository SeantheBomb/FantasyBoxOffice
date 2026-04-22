// Fantasy Box Office cron worker. Runs three scheduled jobs:
//   0 9 * * *  — refresh TMDB movies (budget/poster/release)
//   0 14 * * * — scrape Box Office Mojo dailies for released movies
//   * * * * *  — settle expired auctions
//
// Shares logic with the Pages Functions in ../../functions/api via relative imports.

import { refreshMovies, rollStatuses } from "../../functions/api/_tmdb.js";
import { refreshDailies } from "../../functions/api/_boxoffice.js";
import { settleExpiredAuctions } from "../../functions/api/_settlement.js";

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
    }
  },

  // Manual trigger for local testing: POST /trigger?job=movies|dailies|settle
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/trigger") {
      return new Response("fbo-cron: use /trigger?job=...", { status: 200 });
    }
    const job = url.searchParams.get("job");
    let result;
    if (job === "movies") result = await runMoviesRefresh(env);
    else if (job === "dailies") result = await runDailiesRefresh(env);
    else if (job === "settle") result = await runSettleExpired(env);
    else return new Response("job must be movies|dailies|settle", { status: 400 });
    return new Response(JSON.stringify(result), {
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
  return settleExpiredAuctions(env.DB);
}
