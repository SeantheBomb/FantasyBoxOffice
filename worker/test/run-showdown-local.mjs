#!/usr/bin/env node
// Local test for the weekend showdown: escrow, the auction-hold guard,
// settlement payouts, idempotency, ties, refunds, and the Discord posts.
//
// Usage: node --loader ./worker/test/loader.mjs ./worker/test/run-showdown-local.mjs

import Database from "better-sqlite3";
import { createD1Shim } from "./d1-shim.mjs";
import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  placeShowdownBet,
  settleShowdown,
  refundShowdownBetsForMovie,
  getAvailablePoints,
  parseStake,
  getShowdownBoard,
} from "../../functions/api/_showdown.js";
import { runShowdownSettlement } from "../src/showdown-job.js";
import { runLastCallPost } from "../src/last-call-job.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationDir = resolve(__dirname, "../../migrations");

const sqlite = new Database(":memory:");
const db = createD1Shim(sqlite);
for (const f of readdirSync(migrationDir).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(resolve(migrationDir, f), "utf-8").replace(/--.*$/gm, "");
  for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    try { sqlite.exec(stmt); } catch (e) { if (!e.message.includes("duplicate column")) throw e; }
  }
}

function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const today = new Date().toISOString().slice(0, 10);
const openWk = addDays(today, 10);   // betting still open
const pastWk = addDays(today, -2);   // settles via the job
const tieWk = addDays(today, -20);
const now = new Date().toISOString();

sqlite.exec(`
  INSERT INTO users (id, email, username, real_name, password_hash, password_salt, created_at, points_remaining, in_league, discord_user_id) VALUES
    ('u1','a@t','Alice','A','h','s','${now}',50,1,'111'),
    ('u2','b@t','Bob','B','h','s','${now}',40,1,'222'),
    ('u3','c@t','Carol','C','h','s','${now}',30,1,'333'),
    ('u4','d@t','Dave','D','h','s','${now}',10,1,NULL);
  INSERT INTO movies (tmdb_id, title, release_date, status, poster_url, created_at) VALUES
    (1,'Alpha','${openWk}','unreleased','https://img/1.jpg','${now}'),
    (2,'Bravo','${openWk}','unreleased','https://img/2.jpg','${now}'),
    (3,'Charlie','${openWk}','unreleased',NULL,'${now}'),
    (9,'Solo','${openWk}','unreleased',NULL,'${now}');
  INSERT INTO weekend_movies (tmdb_id, weekend_date) VALUES (1,'${openWk}'),(2,'${openWk}'),(3,'${openWk}');
  INSERT INTO auctions (id, tmdb_id, status, current_bid, current_bidder_id, started_by_user_id, ends_at, created_at)
    VALUES ('a1', 9, 'open', 15, 'u2', 'u2', '${addDays(today, 1)}T00:00:00Z', '${now}');
`);

let passed = 0, failed = 0;
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const bal = (id) => sqlite.prepare("SELECT points_remaining p FROM users WHERE id = ?").get(id).p;

const discord = [];
globalThis.fetch = async (url, init) => {
  discord.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
  return new Response("{}", { status: 200 });
};

console.log("\n── Stake parsing ──");
check("'all' → available", parseStake("all", 25) === 25);
check("'All In' → available", parseStake("All In", 25) === 25);
check("'12' → 12", parseStake("12", 25) === 12);
check("'1.5' rejected", parseStake("1.5", 25) === null);

console.log("\n── Placing bets ──");
let r = await placeShowdownBet(db, { userId: "u1", weekendDate: openWk, tmdbId: 1, stake: 20 });
check("Alice stakes 20 on Alpha", r.ok && r.balance === 30 && bal("u1") === 30, JSON.stringify(r));
r = await placeShowdownBet(db, { userId: "u1", weekendDate: openWk, tmdbId: 2, stake: 5 });
check("second bet is rejected (locked in)", r.error?.includes("already locked in") && bal("u1") === 30);

const bob = await getAvailablePoints(db, "u2");
check("Bob's leading auction bid is held back", bob.available === 25 && bob.held === 15, JSON.stringify(bob));
r = await placeShowdownBet(db, { userId: "u2", weekendDate: openWk, tmdbId: 1, stake: 30 });
check("Bob can't stake points tied up in the auction", !!r.error && bal("u2") === 40);
r = await placeShowdownBet(db, { userId: "u2", weekendDate: openWk, tmdbId: 1, stake: parseStake("all", bob.available) });
check("Bob goes all in (25)", r.ok && r.all_in && bal("u2") === 15, JSON.stringify(r));

r = await placeShowdownBet(db, { userId: "u3", weekendDate: openWk, tmdbId: 9, stake: 5 });
check("movie outside the lineup rejected", !!r.error && bal("u3") === 30);
r = await placeShowdownBet(db, { userId: "u3", weekendDate: openWk, tmdbId: 2, stake: 0 });
check("zero stake rejected", !!r.error);
r = await placeShowdownBet(db, { userId: "u3", weekendDate: openWk, tmdbId: 2, stake: 10 });
check("Carol stakes 10 on Bravo", r.ok && bal("u3") === 20);
r = await placeShowdownBet(db, { userId: "u4", weekendDate: openWk, tmdbId: 2, stake: 10 });
check("Dave goes all in on Bravo", r.ok && r.all_in && bal("u4") === 0);
r = await placeShowdownBet(db, { userId: "u4", weekendDate: pastWk, tmdbId: 1, stake: 1 });
check("closed weekend rejected", !!r.error);

const board = await getShowdownBoard(db, openWk);
const alpha = board.movies.find((m) => m.tmdb_id === 1);
check("board tallies backers and points", alpha.backers === 2 && alpha.points === 45, JSON.stringify(alpha));

console.log("\n── Last call ──");
discord.length = 0;
await runLastCallPost({ DB: db, DISCORD_WEBHOOK_URL: "https://discord/test" });
const lastCall = discord[0]?.body?.content ?? "";
check("last call includes the showdown section", lastCall.includes("⚔️ Showdown") && lastCall.includes("Alpha"));

console.log("\n── Settlement ──");
sqlite.exec(`INSERT INTO dailies (tmdb_id, date, domestic_revenue, source, scraped_at) VALUES
  (1,'${addDays(openWk, 3)}',48213402,'bom','${now}'),
  (2,'${addDays(openWk, 3)}',31002118,'bom','${now}')`);
let s = await settleShowdown(db, openWk);
check("pending while a movie has no BOM number", s.status === "pending" && s.missing.includes("Charlie"), JSON.stringify(s));
check("pending touches no balances", bal("u1") === 30 && bal("u4") === 0);

sqlite.exec(`INSERT INTO dailies (tmdb_id, date, domestic_revenue, source, scraped_at) VALUES (3,'${addDays(openWk, 2)}',5000000,'bom','${now}')`);
s = await settleShowdown(db, openWk);
check("settles with Alpha the winner", s.status === "settled" && s.winner_tmdb_id === 1, JSON.stringify({ status: s.status, w: s.winner_tmdb_id }));
check("Alice 30 → 70 (+20 net)", bal("u1") === 70, bal("u1"));
check("Bob 15 → 65 (+25 net)", bal("u2") === 65, bal("u2"));
check("Carol stays 20 (−10 net)", bal("u3") === 20, bal("u3"));
check("Dave stays 0 (busted)", bal("u4") === 0, bal("u4"));
check("results flag Dave as BUSTED", s.content.includes("BUSTED") && s.content.includes("**Dave**"));
check("results hide the winner behind a spoiler", s.content.includes("||🏆 **Alpha** — $48,213,402"));
check("results show margin to the dollar-ish", s.content.includes("$17.2M"));

if (process.env.SHOW) console.log("\n" + s.content + "\n\n" + lastCall + "\n");
s = await settleShowdown(db, openWk);
check("second settle is a no-op", s.status === "already_settled" && bal("u1") === 70 && bal("u2") === 65);

console.log("\n── Tie → push ──");
sqlite.exec(`
  INSERT INTO weekend_movies (tmdb_id, weekend_date) VALUES (1,'${tieWk}'),(2,'${tieWk}');
  INSERT INTO showdown_bets (id, user_id, weekend_date, tmdb_id, stake) VALUES ('t1','u1','${tieWk}',1,5),('t2','u3','${tieWk}',2,7);
  UPDATE users SET points_remaining = points_remaining - 5 WHERE id = 'u1';
  UPDATE users SET points_remaining = points_remaining - 7 WHERE id = 'u3';
`);
s = await settleShowdown(db, tieWk, { grosses: { 1: 20000000, 2: 20000000 } });
check("exact tie pushes", s.status === "push" && bal("u1") === 70 && bal("u3") === 20, JSON.stringify({ st: s.status, a: bal("u1"), c: bal("u3") }));
check("tie post says DEAD HEAT", s.content.includes("DEAD HEAT"));

console.log("\n── Refund for a pulled movie ──");
sqlite.exec(`
  INSERT INTO weekend_movies (tmdb_id, weekend_date) VALUES (1,'${pastWk}'),(2,'${pastWk}');
  INSERT INTO showdown_bets (id, user_id, weekend_date, tmdb_id, stake) VALUES ('p1','u1','${pastWk}',1,10),('p2','u2','${pastWk}',2,5),('p3','u3','${pastWk}',1,4);
  UPDATE users SET points_remaining = points_remaining - 10 WHERE id = 'u1';
  UPDATE users SET points_remaining = points_remaining - 5 WHERE id = 'u2';
  UPDATE users SET points_remaining = points_remaining - 4 WHERE id = 'u3';
`);
const refunded = await refundShowdownBetsForMovie(db, 2, pastWk);
check("refunds the stake on the pulled movie", refunded.length === 1 && bal("u2") === 65);
await refundShowdownBetsForMovie(db, 2, pastWk);
check("refund is idempotent", bal("u2") === 65);

console.log("\n── Monday job settlement + post ──");
sqlite.exec(`INSERT INTO dailies (tmdb_id, date, domestic_revenue, source, scraped_at) VALUES
  (1,'${addDays(pastWk, 2)}',12000000,'bom','${now}'),(2,'${addDays(pastWk, 2)}',15000000,'bom','${now}')`);
discord.length = 0;
const job = await runShowdownSettlement({ DB: db, DISCORD_WEBHOOK_URL: "https://discord/test" }, { fromDays: 3, toDays: 1 });
const entry = job.results.find((e) => e.weekend_date === pastWk);
check("job settles last weekend and posts", entry?.status === "settled" && entry.discord_posted, JSON.stringify(job));
check("Alice and Carol lost on Alpha (Bravo won)", bal("u1") === 60 && bal("u3") === 16, `${bal("u1")} ${bal("u3")}`);
check("results post calls out that nobody called it", discord[0]?.body?.content.includes("Nobody called it"));
const again = await runShowdownSettlement({ DB: db, DISCORD_WEBHOOK_URL: "https://discord/test" }, { fromDays: 3, toDays: 1 });
check("job does not re-post a settled weekend", !again.results.some((e) => e.weekend_date === pastWk));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
