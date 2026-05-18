import { json, badRequest, requireAdmin } from "../../_auth.js";
import { formatShort } from "../../_format.js";

const POINTS = [3, 2, 1];

async function getActiveDate(db, override) {
  if (override) return override;
  const row = await db
    .prepare(
      `SELECT DISTINCT weekend_date FROM weekend_movies
       WHERE weekend_date >= date('now', '-3 days')
       ORDER BY weekend_date ASC LIMIT 1`
    )
    .first();
  return row?.weekend_date ?? null;
}

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const weekendDate = await getActiveDate(
    env.DB,
    new URL(request.url).searchParams.get("weekend_date")
  );
  if (!weekendDate) return json({ weekend_date: null, movies: [], picks: {}, abstentions: {} });

  const [{ results: movies }, { results: allPicks }, { results: leagueUsers }] = await Promise.all([
    env.DB.prepare(
      `SELECT m.tmdb_id, m.title, m.poster_url, u.username AS owner,
              wr.actual_gross, wr.scored_at
       FROM weekend_movies wm
       JOIN movies m ON m.tmdb_id = wm.tmdb_id
       JOIN owned_movies om ON om.tmdb_id = wm.tmdb_id AND om.is_void = 0
       JOIN users u ON u.id = om.owner_user_id
       LEFT JOIN weekend_results wr ON wr.tmdb_id = wm.tmdb_id AND wr.weekend_date = wm.weekend_date
       WHERE wm.weekend_date = ? ORDER BY m.title`
    )
      .bind(weekendDate)
      .all(),
    env.DB.prepare(
      `SELECT wp.discord_user_id, wp.discord_username, wp.tmdb_id, wp.estimate,
              wp.points_awarded, u.username AS fbo_username
       FROM weekend_picks wp
       LEFT JOIN users u ON u.discord_user_id = wp.discord_user_id
       WHERE wp.weekend_date = ?
       ORDER BY wp.tmdb_id, wp.estimate DESC`
    )
      .bind(weekendDate)
      .all(),
    env.DB.prepare(
      `SELECT id, username, discord_user_id FROM users
       WHERE in_league = 1 AND discord_user_id IS NOT NULL`
    ).all(),
  ]);

  const picksByMovie = {};
  for (const p of allPicks) {
    if (!picksByMovie[p.tmdb_id]) picksByMovie[p.tmdb_id] = [];
    picksByMovie[p.tmdb_id].push(p);
  }

  const abstentionsByMovie = {};
  for (const m of movies) {
    const pickers = new Set((picksByMovie[m.tmdb_id] || []).map((p) => p.discord_user_id));
    abstentionsByMovie[m.tmdb_id] = leagueUsers.filter((u) => !pickers.has(u.discord_user_id));
  }

  return json({ weekend_date: weekendDate, movies, picks: picksByMovie, abstentions: abstentionsByMovie });
}

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.weekend_date || !body?.tmdb_id || body.actual_gross == null) {
    return badRequest("weekend_date, tmdb_id, and actual_gross required");
  }

  const { weekend_date, tmdb_id, actual_gross } = body;

  await env.DB.prepare(
    `INSERT INTO weekend_results (tmdb_id, weekend_date, actual_gross)
     VALUES (?, ?, ?)
     ON CONFLICT(tmdb_id, weekend_date)
     DO UPDATE SET actual_gross = excluded.actual_gross, scored_at = datetime('now')`
  )
    .bind(tmdb_id, weekend_date, actual_gross)
    .run();

  const movie = await env.DB.prepare(`SELECT title FROM movies WHERE tmdb_id = ?`)
    .bind(tmdb_id)
    .first();

  const { results: picks } = await env.DB.prepare(
    `SELECT discord_user_id, discord_username, estimate FROM weekend_picks
     WHERE tmdb_id = ? AND weekend_date = ?
     ORDER BY ABS(estimate - ?) ASC`
  )
    .bind(tmdb_id, weekend_date, actual_gross)
    .all();

  const { results: leagueUsers } = await env.DB.prepare(
    `SELECT username, discord_user_id FROM users
     WHERE in_league = 1 AND discord_user_id IS NOT NULL`
  ).all();

  const scored = picks.map((p, i) => ({ ...p, points: POINTS[i] ?? 0 }));
  const pickerIds = new Set(scored.map((p) => p.discord_user_id));
  const abstentions = leagueUsers.filter((u) => !pickerIds.has(u.discord_user_id));

  if (scored.length) {
    await env.DB.batch(
      scored.map((p) =>
        env.DB.prepare(
          `UPDATE weekend_picks SET points_awarded = ?
           WHERE discord_user_id = ? AND tmdb_id = ? AND weekend_date = ?`
        ).bind(p.points, p.discord_user_id, tmdb_id, weekend_date)
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
    const { results: totals } = await env.DB.prepare(
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

  if (env.DISCORD_GAME_FEED_WEBHOOK_URL) {
    await fetch(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).catch(() => {});
  }

  return json({ ok: true, movie: title, actual_gross, scored, abstentions: abstentions.length, content });
}

function buildPickLine(p, i, total) {
  const mention = `<@${p.discord_user_id}>`;
  const pts = p.points;
  const ptsStr = pts === 1 ? "earning 1 point" : pts > 0 ? `earning ${pts} points` : "earning no points";
  if (i === 0) return `${mention} has 1st place betting ${formatShort(p.estimate)} ${ptsStr} (${total} total)`;
  if (i === 1) return `${mention} has 2nd place with ${formatShort(p.estimate)} ${ptsStr} (${total} total)`;
  if (i === 2) return `${mention} has 3rd place with ${formatShort(p.estimate)} ${ptsStr} (${total} total)`;
  return `${mention} had last place with ${formatShort(p.estimate)} ${ptsStr} (${total} total)`;
}
