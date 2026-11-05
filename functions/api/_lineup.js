// Weekend lineup helpers. A release belongs to the box-office weekend of the
// Friday it falls around: Monday–Thursday openers (Tuesday IMAX runs,
// Wednesday holiday openings) count toward that Friday, so the window is
// weekend_date − 4 days through + 2 days.

export function nextFriday(from = new Date()) {
  const d = new Date(from);
  const days = ((5 - d.getUTCDay() + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function ownedMoviesOpening(db, weekendDate) {
  const { results } = await db
    .prepare(
      `SELECT m.tmdb_id, m.title, m.release_date, u.username AS owner
       FROM movies m
       JOIN owned_movies om ON om.tmdb_id = m.tmdb_id AND om.is_void = 0
       JOIN users u ON u.id = om.owner_user_id
       WHERE m.release_date BETWEEN date(?, '-4 days') AND date(?, '+2 days')
         AND m.status != 'complete'
       ORDER BY m.title`
    )
    .bind(weekendDate, weekendDate)
    .all();
  return results;
}

// Owned movies opening that weekend that aren't in its lineup.
export async function missingFromLineup(db, weekendDate) {
  const opening = await ownedMoviesOpening(db, weekendDate);
  const { results } = await db
    .prepare(`SELECT tmdb_id FROM weekend_movies WHERE weekend_date = ?`)
    .bind(weekendDate)
    .all();
  const inLineup = new Set(results.map((r) => r.tmdb_id));
  return opening.filter((m) => !inLineup.has(m.tmdb_id));
}

// Fills an empty lineup from owned movies opening that weekend. A lineup an
// admin already saved is left alone (gaps are surfaced by the warning instead).
export async function autoFillLineup(db, weekendDate) {
  const existing = await db
    .prepare(`SELECT 1 FROM weekend_movies WHERE weekend_date = ? LIMIT 1`)
    .bind(weekendDate)
    .first();
  if (existing) return { filled: false, movies: [] };

  const movies = await ownedMoviesOpening(db, weekendDate);
  if (!movies.length) return { filled: false, movies: [] };
  await db.batch(
    movies.map((m) =>
      db.prepare(`INSERT OR IGNORE INTO weekend_movies (tmdb_id, weekend_date) VALUES (?, ?)`).bind(m.tmdb_id, weekendDate)
    )
  );
  return { filled: true, movies };
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Discord warning pinging admins, or null when the lineup is complete.
export async function missingLineupWarning(db, weekendDate) {
  const missing = await missingFromLineup(db, weekendDate);
  if (!missing.length) return null;
  const { results: admins } = await db
    .prepare(`SELECT discord_user_id FROM users WHERE is_admin = 1 AND discord_user_id IS NOT NULL`)
    .all();
  const ping = admins.map((a) => `<@${a.discord_user_id}>`).join(" ");
  const list = missing
    .map((m) => {
      const day = WEEKDAY[new Date(m.release_date + "T12:00:00Z").getUTCDay()];
      return `• **${m.title}** (${m.owner}) — opens ${day} ${m.release_date}`;
    })
    .join("\n");
  return `⚠️ ${ping ? `${ping} ` : ""}**Lineup check:** these owned movies open this weekend but aren't in the betting lineup. Add them in Admin → Weekend Predictions:\n${list}`;
}
