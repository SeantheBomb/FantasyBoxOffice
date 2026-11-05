#!/usr/bin/env node
// Local test for weekend lineup safeguards: the Mon–Sun release window,
// auto-fill, the missing-movie warning, and pinning owned movies to their
// US wide-release date.
//
// Usage: node --loader ./worker/test/loader.mjs ./worker/test/run-lineup-local.mjs

import Database from "better-sqlite3";
import { createD1Shim } from "./d1-shim.mjs";
import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  nextFriday,
  ownedMoviesOpening,
  missingFromLineup,
  autoFillLineup,
  missingLineupWarning,
} from "../../functions/api/_lineup.js";
import { pinWideReleaseDates } from "../../functions/api/_tmdb.js";

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
const fri = nextFriday();
const now = new Date().toISOString();

sqlite.exec(`
  INSERT INTO users (id, email, username, real_name, password_hash, password_salt, created_at, points_remaining, in_league, is_admin, discord_user_id) VALUES
    ('u1','a@t','Sean','S','h','s','${now}',50,1,1,'900'),
    ('u2','b@t','Will','W','h','s','${now}',50,1,0,'901');
  INSERT INTO movies (tmdb_id, title, release_date, status, created_at) VALUES
    (1,'Tuesday IMAX Opener','${addDays(fri, -3)}','unreleased','${now}'),
    (2,'Friday Opener','${fri}','unreleased','${now}'),
    (3,'Last Sunday','${addDays(fri, -5)}','unreleased','${now}'),
    (4,'Next Monday','${addDays(fri, 3)}','unreleased','${now}'),
    (5,'Unowned Friday','${fri}','unreleased','${now}'),
    (6,'Voided Friday','${fri}','unreleased','${now}');
  INSERT INTO owned_movies (tmdb_id, owner_user_id, purchase_price, is_void, acquired_at) VALUES
    (1,'u2',5,0,'${now}'),(2,'u1',5,0,'${now}'),(3,'u1',5,0,'${now}'),(4,'u1',5,0,'${now}'),(6,'u2',5,1,'${now}');
`);

let passed = 0, failed = 0;
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n── Release window ──");
check("nextFriday is a Friday after today", new Date(fri + "T12:00:00Z").getUTCDay() === 5 && fri > now.slice(0, 10));
const opening = (await ownedMoviesOpening(db, fri)).map((m) => m.tmdb_id).sort();
check("Mon–Sun window: Tuesday + Friday owned openers only", JSON.stringify(opening) === "[1,2]", JSON.stringify(opening));

console.log("\n── Auto-fill ──");
let fill = await autoFillLineup(db, fri);
check("empty lineup is filled", fill.filled && fill.movies.length === 2);
sqlite.exec(`DELETE FROM weekend_movies WHERE tmdb_id = 1`);
fill = await autoFillLineup(db, fri);
check("existing lineup is left alone", !fill.filled && sqlite.prepare("SELECT COUNT(*) n FROM weekend_movies").get().n === 1);

console.log("\n── Missing-movie warning ──");
const missing = await missingFromLineup(db, fri);
check("detects the dropped Tuesday opener", missing.length === 1 && missing[0].tmdb_id === 1);
const warning = await missingLineupWarning(db, fri);
check("warning pings admins and names the movie + owner", warning?.includes("<@900>") && warning.includes("Tuesday IMAX Opener") && warning.includes("(Will)") && warning.includes("opens Tue"), warning);
sqlite.exec(`INSERT INTO weekend_movies (tmdb_id, weekend_date) VALUES (1, '${fri}')`);
check("no warning once the lineup is complete", (await missingLineupWarning(db, fri)) === null);

console.log("\n── Wide-release pinning ──");
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  const id = Number(String(url).match(/movie\/(\d+)\/release_dates/)?.[1]);
  const us = {
    1: [{ type: 2, release_date: `${addDays(fri, -3)}T00:00:00.000Z` }, { type: 3, release_date: `${fri}T00:00:00.000Z` }],
    2: [{ type: 3, release_date: `${fri}T00:00:00.000Z` }],
    3: [{ type: 2, release_date: `${addDays(fri, -5)}T00:00:00.000Z` }],
  }[id] ?? [];
  return new Response(JSON.stringify({ results: [{ iso_3166_1: "US", release_dates: us }, { iso_3166_1: "JP", release_dates: [{ type: 3, release_date: "2020-01-01T00:00:00Z" }] }] }), { status: 200 });
};
const pinned = await pinWideReleaseDates({ db, token: "t" });
const dateOf = (id) => sqlite.prepare("SELECT release_date d FROM movies WHERE tmdb_id = ?").get(id).d;
check("IMAX-Tuesday movie pinned to its wide Friday", dateOf(1) === fri, dateOf(1));
check("already-correct movie untouched", dateOf(2) === fri);
check("limited-only movie keeps its date", dateOf(3) === addDays(fri, -5));
check("unowned movies aren't looked up", !calls.some((u) => u.includes("/movie/5/")));
check("reports exactly one change", pinned.changed.length === 1 && pinned.changed[0].tmdb_id === 1, JSON.stringify(pinned));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
