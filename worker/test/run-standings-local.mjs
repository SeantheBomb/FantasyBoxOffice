#!/usr/bin/env node
// Local test for the Monday standings job.
// Seeds an in-memory SQLite DB, stubs fetch, runs runStandingsPost,
// and validates scoring, standings, and Discord posts.
//
// Usage: node worker/test/run-standings-local.mjs

import Database from "better-sqlite3";
import { createD1Shim } from "./d1-shim.mjs";
import { seedDatabase, createFetchStub } from "./seed.mjs";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

// ── Setup ────────────────────────────────────────────────────────────────

const sqlite = new Database(":memory:");
const db = createD1Shim(sqlite);

// Run migrations
const migrationDir = resolve(root, "migrations");
const migrationFiles = [
  "0001_init.sql", "0002_game.sql", "0003_catalog_and_import.sql",
  "0004_auction_passes.sql", "0005_in_league.sql", "0006_budget_placeholder.sql",
  "0007_weekend_picks.sql", "0008_discord_user_id.sql", "0009_movies_overview.sql",
];
for (const f of migrationFiles) {
  const sql = readFileSync(resolve(migrationDir, f), "utf-8");
  // Split on semicolons and run each statement (ALTER TABLE can't be batched in SQLite)
  for (const stmt of sql.split(";").map(s => s.trim()).filter(Boolean)) {
    try {
      sqlite.exec(stmt);
    } catch (e) {
      // Ignore "duplicate column" from ALTERs on a fresh DB
      if (!e.message.includes("duplicate column")) throw e;
    }
  }
}

// Seed test data
const { wkDate, futureWk } = seedDatabase(sqlite);

// Stub fetch globally
const discordCapture = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = createFetchStub(discordCapture);

// Build env
const env = {
  DB: db,
  TMDB_TOKEN: "fake-tmdb-token",
  DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/test/test",
};

// ── Run ──────────────────────────────────────────────────────────────────

console.log("\n🏗️  Running standings job against local DB...\n");

const { runStandingsPost } = await import("../src/standings-job.js");
let result;
try {
  result = await runStandingsPost(env);
} catch (e) {
  console.error("❌ runStandingsPost threw:", e);
  process.exit(1);
}

// ── Assertions ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("\n── Scoring ─────────────────────────────────────────────\n");

// Check weekend_results was created
const wr = sqlite.prepare("SELECT * FROM weekend_results WHERE tmdb_id = 1001 AND weekend_date = ?").get(wkDate);
check("weekend_results row exists", !!wr);
check("actual_gross is $44M", wr?.actual_gross === 44000000, `got ${wr?.actual_gross}`);

// Check points_awarded on picks
const picks = sqlite.prepare(
  "SELECT discord_username, estimate, points_awarded FROM weekend_picks WHERE weekend_date = ? ORDER BY points_awarded DESC"
).all(wkDate);

check("3 picks scored", picks.length === 3, `got ${picks.length}`);

// Alice=$45M (closest to $44M) → 3pts, Carol=$50M → 2pts, Bob=$30M → 1pt
const alice = picks.find(p => p.discord_username === "Alice");
const carol = picks.find(p => p.discord_username === "Carol");
const bob = picks.find(p => p.discord_username === "Bob");

check("Alice (closest) gets 3 pts", alice?.points_awarded === 3, `got ${alice?.points_awarded}`);
check("Carol (2nd closest) gets 2 pts", carol?.points_awarded === 2, `got ${carol?.points_awarded}`);
check("Bob (farthest) gets 1 pt", bob?.points_awarded === 1, `got ${bob?.points_awarded}`);

// Check user point balances updated
const aliceUser = sqlite.prepare("SELECT points_remaining FROM users WHERE id = 'u1'").get();
const carolUser = sqlite.prepare("SELECT points_remaining FROM users WHERE id = 'u3'").get();
const bobUser = sqlite.prepare("SELECT points_remaining FROM users WHERE id = 'u2'").get();

check("Alice points = 50 + 3 = 53", aliceUser?.points_remaining === 53, `got ${aliceUser?.points_remaining}`);
check("Carol points = 30 + 2 = 32", carolUser?.points_remaining === 32, `got ${carolUser?.points_remaining}`);
check("Bob points = 40 + 1 = 41", bobUser?.points_remaining === 41, `got ${bobUser?.points_remaining}`);

console.log("\n── Scoring Result Object ────────────────────────────────\n");

const sr = result.scoring;
check("scoring has results array", Array.isArray(sr?.results), `got ${JSON.stringify(sr)}`);
if (sr?.results) {
  const m = sr.results.find(r => r.tmdb_id === 1001);
  check("movie 1001 scored=true", m?.scored === true, `got ${JSON.stringify(m)}`);
  check("movie 1001 discord_posted=true", m?.discord_posted === true, `got ${JSON.stringify(m)}`);
}

console.log("\n── Discord Posts ────────────────────────────────────────\n");

check("Discord webhook called ≥ 2 times", discordCapture.length >= 2, `called ${discordCapture.length} times`);

// Find the scoring post (contains "opened to")
const scoringPost = discordCapture.find(c => {
  const content = c.body?.content || "";
  return content.includes("opened to");
});
check("scoring results posted to Discord", !!scoringPost);
if (scoringPost) {
  check("scoring post mentions Alice", scoringPost.body.content.includes("Alice") || scoringPost.body.content.includes("111111111111111111"));
}

// Find the standings post (multipart with chart image, or first message with standings content)
const standingsPost = discordCapture.find(c => c.body?.formData || (c.raw && typeof c.raw !== "string"));
check("standings posted with chart attachment", !!standingsPost);

console.log("\n── Standings Result Object ──────────────────────────────\n");

check("standings posted=true", result.posted === true, `got ${result.posted}`);
check("no standings error", !result.standings_error, `got ${result.standings_error}`);
check("chart bytes > 0", result.chart_bytes > 0, `got ${result.chart_bytes}`);
check("users count > 0", result.users > 0, `got ${result.users}`);

console.log("\n── Weekend Announcement ─────────────────────────────────\n");

// The announcement should fire if the future weekend has an owned movie
// Movie 1004 is unreleased + owned by Bob, in weekend_movies for futureWk
// But the announcement query requires owned_movies + wm.weekend_date >= date('now')
// and movie 1004 IS in owned_movies and IS in weekend_movies for futureWk
const ann = result.announcement;
check("announcement posted", ann?.posted === true, `got ${JSON.stringify(ann)}`);

if (ann?.posted) {
  const annPost = discordCapture.find(c => {
    const content = c.body?.content || "";
    return content.includes("Opening Weekend") || content.includes("opening");
  });
  check("announcement Discord post found", !!annPost);
}

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(56)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(56)}\n`);

// Restore
globalThis.fetch = originalFetch;
sqlite.close();

process.exit(failed > 0 ? 1 : 0);
