import { discoverBomSlug, scrapeDomestic } from "../../functions/api/_boxoffice.js";
import { bootstrapSchema } from "../../functions/api/_schema.js";
import {
  getShowdownBoard,
  settleShowdown,
  claimShowdownPost,
  postShowdownContent,
  taleOfTheTape,
  fmtWeekend,
  fmtDollars,
} from "../../functions/api/_showdown.js";

// Settles showdowns with open bets whose weekend_date falls between fromDays
// and toDays ago. A showdown nobody played is never recorded. The Monday
// standings job covers last weekend; the daily cron retries anything still
// waiting on BOM numbers.
export async function runShowdownSettlement(env, { fromDays, toDays }) {
  await bootstrapSchema(env.DB);
  const { results: weekends } = await env.DB.prepare(
    `SELECT DISTINCT weekend_date FROM showdown_bets
     WHERE weekend_date BETWEEN date('now', ?) AND date('now', ?) AND outcome IS NULL`
  ).bind(`-${fromDays} days`, `-${toDays} days`).all();

  const out = [];
  for (const { weekend_date } of weekends) {
    let result;
    try {
      result = await settleShowdown(env.DB, weekend_date);
    } catch (e) {
      out.push({ weekend_date, error: e.message || String(e) });
      continue;
    }
    const entry = { weekend_date, status: result.status, bets: result.outcomes?.length ?? 0, discord_posted: false };

    if (result.content && env.DISCORD_WEBHOOK_URL) {
      try {
        await postShowdownContent(env.DISCORD_WEBHOOK_URL, result.content);
        entry.discord_posted = true;
      } catch (e) {
        entry.discord_error = e.message || String(e);
      }
    }

    if (result.status === "pending") {
      entry.missing = result.missing;
      const board = await getShowdownBoard(env.DB, weekend_date);
      if (board.bets.length && env.DISCORD_WEBHOOK_URL && await claimShowdownPost(env.DB, weekend_date, "delayed")) {
        await postShowdownContent(
          env.DISCORD_WEBHOOK_URL,
          `⏳ **Showdown results for ${fmtWeekend(weekend_date)} are on hold** — Box Office Mojo hasn't posted numbers for ${result.missing.map((t) => `**${t}**`).join(", ")} yet. They'll drop automatically once it does. The tension builds…`
        ).catch(() => {});
      }
    }
    out.push(entry);
  }
  return { results: out };
}

// Mid-weekend leaderboard from live BOM numbers. kind: halftime | sunday.
export async function runShowdownHalftime(env, kind) {
  if (!env.DISCORD_WEBHOOK_URL) return { skipped: "DISCORD_WEBHOOK_URL missing" };
  await bootstrapSchema(env.DB);
  const { results: weekends } = await env.DB.prepare(
    `SELECT DISTINCT weekend_date FROM showdown_bets
     WHERE outcome IS NULL AND weekend_date BETWEEN date('now', '-2 days') AND date('now')`
  ).all();

  const out = [];
  for (const { weekend_date } of weekends) {
    const board = await getShowdownBoard(env.DB, weekend_date);
    if (board.movies.length < 2) continue;

    const live = [];
    for (const m of board.movies) {
      let slug = m.bom_slug;
      if (!slug && env.TMDB_TOKEN) {
        slug = await discoverBomSlug(m.tmdb_id, env.TMDB_TOKEN).catch(() => null);
        if (slug) await env.DB.prepare(`UPDATE movies SET bom_slug = ? WHERE tmdb_id = ?`).bind(slug, m.tmdb_id).run();
      }
      const revenue = slug ? (await scrapeDomestic(slug).catch(() => ({}))).revenue : null;
      live.push({ ...m, revenue: revenue ?? null });
    }

    const reporting = live.filter((m) => m.revenue != null).sort((a, b) => b.revenue - a.revenue);
    if (reporting.length < 2) {
      out.push({ weekend_date, skipped: "not enough BOM numbers yet" });
      continue;
    }
    // Claimed only after the scrape succeeds so a BOM hiccup doesn't burn the post.
    if (!(await claimShowdownPost(env.DB, weekend_date, kind))) continue;

    const [leader, second] = reporting;
    const lines = [
      `## 📊 Showdown ${kind === "sunday" ? "Sunday Update" : "Halftime"} — ${fmtWeekend(weekend_date)}`,
      "Latest Box Office Mojo numbers:",
      "",
      ...reporting.map((m, i) =>
        i === 0
          ? `🔥 **${m.title}** — ${fmtDollars(m.revenue)} · leads by **${fmtDollars(m.revenue - second.revenue)}**`
          : `${i + 1}. **${m.title}** — ${fmtDollars(m.revenue)}`
      ),
      ...live.filter((m) => m.revenue == null).map((m) => `❔ **${m.title}** — no numbers yet`),
      "",
      "**Money on the line**",
      taleOfTheTape(board.movies),
      "",
      leader.points >= Math.max(...board.movies.map((m) => m.points))
        ? "The favorite is out front. Final results drop Monday. 🍿"
        : "👀 The underdog is out front! Final results drop Monday. 🍿",
    ];
    await postShowdownContent(env.DISCORD_WEBHOOK_URL, lines.join("\n"));
    out.push({ weekend_date, posted: true, leader: leader.title });
  }
  return { results: out };
}
