// Shared scoring logic used by the admin score endpoint and the Monday cron.

import { formatShort } from "./_format.js";

const POINTS = [3, 2, 1];

export async function scoreMovie(db, { tmdb_id, weekend_date, actual_gross }) {
  await db
    .prepare(
      `INSERT INTO weekend_results (tmdb_id, weekend_date, actual_gross)
       VALUES (?, ?, ?)
       ON CONFLICT(tmdb_id, weekend_date)
       DO UPDATE SET actual_gross = excluded.actual_gross, scored_at = datetime('now')`
    )
    .bind(tmdb_id, weekend_date, actual_gross)
    .run();

  const movie = await db
    .prepare(`SELECT title FROM movies WHERE tmdb_id = ?`)
    .bind(tmdb_id)
    .first();

  // Normalize estimates to raw dollars for comparison — website stores integer
  // millions (120 = $120M), Discord stored raw dollars in older picks
  // (120000000 = $120M). The CASE WHEN handles both formats.
  const { results: picks } = await db
    .prepare(
      `SELECT discord_user_id, discord_username, estimate FROM weekend_picks
       WHERE tmdb_id = ? AND weekend_date = ?
       ORDER BY ABS(
         CASE WHEN estimate < 1000000 THEN estimate * 1000000 ELSE estimate END - ?
       ) ASC`
    )
    .bind(tmdb_id, weekend_date, actual_gross)
    .all();

  const { results: leagueUsers } = await db
    .prepare(
      `SELECT username, discord_user_id FROM users
       WHERE in_league = 1 AND discord_user_id IS NOT NULL`
    )
    .all();

  const scored = picks.map((p, i) => ({ ...p, points: POINTS[i] ?? 0 }));
  const pickerIds = new Set(scored.map((p) => p.discord_user_id));
  const abstentions = leagueUsers.filter((u) => !pickerIds.has(u.discord_user_id));

  if (scored.length) {
    await db.batch(
      scored.map((p) =>
        db
          .prepare(
            `UPDATE weekend_picks SET points_awarded = ?
             WHERE discord_user_id = ? AND tmdb_id = ? AND weekend_date = ?`
          )
          .bind(p.points, p.discord_user_id, tmdb_id, weekend_date)
      )
    );
  }

  const allIds = [
    ...scored.map((p) => p.discord_user_id),
    ...abstentions.map((u) => u.discord_user_id),
  ];
  const totalsMap = {};
  if (allIds.length) {
    const ph = allIds.map(() => "?").join(",");
    const { results: totals } = await db
      .prepare(
        `SELECT discord_user_id, SUM(COALESCE(points_awarded, 0)) AS total
         FROM weekend_picks WHERE discord_user_id IN (${ph})
         GROUP BY discord_user_id`
      )
      .bind(...allIds)
      .all();
    for (const t of totals) totalsMap[t.discord_user_id] = t.total;
  }

  const title = movie?.title ?? `Movie #${tmdb_id}`;
  const lines = scored.map((p, i) => buildPickLine(p, i, totalsMap[p.discord_user_id] ?? 0));
  for (const u of abstentions) {
    lines.push(
      `<@${u.discord_user_id}> abstained earning no points (${totalsMap[u.discord_user_id] ?? 0} total)`
    );
  }

  const content = `**${title}** opened to **${formatShort(actual_gross)}**\n\n${lines.join("\n")}`;
  return { title, actual_gross, scored, abstentions: abstentions.length, content };
}

function buildPickLine(p, i, total) {
  const mention = `<@${p.discord_user_id}>`;
  const pts = p.points;
  const ptsStr = pts === 1 ? "earning 1 point" : pts > 0 ? `earning ${pts} points` : "earning no points";
  const rawEstimate = p.estimate < 1_000_000 ? p.estimate * 1_000_000 : p.estimate;
  if (i === 0) return `${mention} has 1st place betting ${formatShort(rawEstimate)} ${ptsStr} (${total} total)`;
  if (i === 1) return `${mention} has 2nd place with ${formatShort(rawEstimate)} ${ptsStr} (${total} total)`;
  if (i === 2) return `${mention} has 3rd place with ${formatShort(rawEstimate)} ${ptsStr} (${total} total)`;
  return `${mention} had last place with ${formatShort(rawEstimate)} ${ptsStr} (${total} total)`;
}
