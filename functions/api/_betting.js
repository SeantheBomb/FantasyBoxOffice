import { bootstrapSchema } from "./_schema.js";

const CLOSE_TZ = "America/New_York";

function tzOffsetMs(ts) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: CLOSE_TZ,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts)).map((p) => [p.type, p.value])
  );
  return Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ts;
}

// Midnight Eastern at the start of weekend_date — i.e. end of Thursday for a
// Friday weekend. Offset is resolved per date so DST is handled.
export function defaultClosesAt(weekendDate) {
  const utcMidnight = Date.parse(weekendDate + "T00:00:00Z");
  return new Date(utcMidnight - tzOffsetMs(utcMidnight)).toISOString();
}

export async function getBettingWindow(db, weekendDate) {
  await bootstrapSchema(db);
  const row = await db
    .prepare(`SELECT closes_at FROM weekend_betting_windows WHERE weekend_date = ?`)
    .bind(weekendDate)
    .first();
  const defaultAt = defaultClosesAt(weekendDate);
  return {
    weekend_date: weekendDate,
    closes_at: row?.closes_at ?? defaultAt,
    default_closes_at: defaultAt,
    override_closes_at: row?.closes_at ?? null,
  };
}

// Weekends still accepting bets, earliest first. Looks back a week so an admin
// override can reopen a weekend whose date has already passed.
export async function getOpenWeekends(db) {
  await bootstrapSchema(db);
  const { results } = await db
    .prepare(
      `SELECT DISTINCT wm.weekend_date, bw.closes_at
       FROM weekend_movies wm
       LEFT JOIN weekend_betting_windows bw ON bw.weekend_date = wm.weekend_date
       WHERE wm.weekend_date >= date('now', '-7 days')
       ORDER BY wm.weekend_date`
    )
    .all();
  const now = Date.now();
  return results
    .map((r) => ({ weekend_date: r.weekend_date, closes_at: r.closes_at ?? defaultClosesAt(r.weekend_date) }))
    .filter((w) => Date.parse(w.closes_at) > now);
}
