// Box Office Mojo scraper. BOM has no public API, so we fetch the HTML and
// parse the cumulative domestic gross out of the title page.
//
// Slug discovery: BOM title URLs look like
//   https://www.boxofficemojo.com/title/tt1234567/
// where tt1234567 is the IMDb ID. TMDB exposes imdb_id on /movie/{id}, so
// discoverBomSlug() grabs it.

import { tmdbFetch } from "./_tmdb";

const UA =
  "Mozilla/5.0 (compatible; FantasyBoxOfficeBot/1.0; +https://fantasyboxoffice.pages.dev)";

export async function discoverBomSlug(tmdbId, token) {
  try {
    const detail = await tmdbFetch(`/movie/${tmdbId}`, token);
    return detail?.imdb_id || null;
  } catch {
    return null;
  }
}

export async function fetchBomPage(slug) {
  const url = `https://www.boxofficemojo.com/title/${slug}/`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`BOM ${res.status}`);
  return res.text();
}

// Parse the domestic total gross from a BOM title page. BOM's performance
// summary section has the shape:
//   <div class="a-section a-spacing-none mojo-performance-summary-table">
//     ...Domestic<span class="money">$123,456,789</span>...
// The fallback path matches any money span shortly after the word "Domestic".
export function parseDomesticFromHtml(html) {
  if (!html) return null;
  const perfIdx = html.indexOf("mojo-performance-summary-table");
  if (perfIdx !== -1) {
    const slice = html.slice(perfIdx, perfIdx + 4000);
    const m = slice.match(/Domestic[\s\S]{0,400}?\$([\d,]+)/);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  const domIdx = html.indexOf("Domestic");
  if (domIdx === -1) return null;
  const slice = html.slice(domIdx, domIdx + 2000);
  const m = slice.match(/\$([\d,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function scrapeDomestic(slug) {
  const html = await fetchBomPage(slug);
  const revenue = parseDomesticFromHtml(html);
  // `no_data`: BOM page exists but has no revenue figure (pre-release,
  // limited release, or foreign-only). Distinguished from a true parse
  // failure where the markup has changed.
  const noData = revenue == null && !html.includes('class="money"');
  return { revenue, noData };
}

// ---------- Historical weekly backfill ----------

// BOM title pages link out to one or more release pages, e.g. a "Domestic"
// release at /release/rl1234567/. Grab the first rl id we find.
export function parseReleaseIdFromTitlePage(html) {
  const m = html && html.match(/\/release\/(rl\d+)\//);
  return m ? m[1] : null;
}

// Parse a BOM release page's weekly chart table into
// [{ date: 'YYYY-MM-DD', cumulative: Number }]. We look for any table whose
// rows contain /date/YYYY-MM-DD/ or /weekend/... links and collect the
// largest $ amount in each row — BOM always has the running total as the
// biggest value in a row.
export function parseWeeklyHistory(html) {
  if (!html) return [];
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((m) => m[1]);
  for (const tbody of tables) {
    if (!tbody.includes("/date/") && !tbody.includes("/weekend/")) continue;
    const rows = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let tr;
    while ((tr = trRegex.exec(tbody)) !== null) {
      const row = tr[1];
      const dm = row.match(/\/date\/(\d{4}-\d{2}-\d{2})\//);
      const wm = !dm && row.match(/\/weekend\/(\d{4})\/(\d+)\//);
      let date = null;
      if (dm) date = dm[1];
      else if (wm) date = weekStartFromYearWeek(Number(wm[1]), Number(wm[2]));
      if (!date) continue;
      const moneys = [...row.matchAll(/\$([\d,]+)/g)]
        .map((m) => Number(m[1].replace(/,/g, "")))
        .filter((n) => Number.isFinite(n));
      if (!moneys.length) continue;
      // Running total is always the largest value in a row.
      rows.push({ date, cumulative: Math.max(...moneys) });
    }
    if (rows.length) return rows;
  }
  return [];
}

// Approximate a date for BOM's /weekend/YYYY/WW/ URLs. ISO-ish: week 1
// starts on the first Monday of the year; BOM's weekends span Fri–Sun so
// we anchor to the Friday.
function weekStartFromYearWeek(year, week) {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const daysToMon = (8 - jan1.getUTCDay()) % 7 || 7;
  const firstMon = new Date(Date.UTC(year, 0, 1 + daysToMon));
  const friday = new Date(firstMon.getTime() + (week - 1) * 7 * 86400000 + 4 * 86400000);
  return friday.toISOString().slice(0, 10);
}

export async function scrapeWeeklyHistory(slug) {
  const titleHtml = await fetchBomPage(slug);
  const releaseId = parseReleaseIdFromTitlePage(titleHtml);
  if (!releaseId) return { rows: [], reason: "no_release_id" };
  const url = `https://www.boxofficemojo.com/release/${releaseId}/`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return { rows: [], reason: `release_page_${res.status}` };
  const rows = parseWeeklyHistory(await res.text());
  return { rows, reason: rows.length ? "ok" : "empty_table" };
}

// Pull weekly cumulative totals from each tracked released movie and upsert
// them into the dailies table. Manual entries are preserved.
export async function backfillDailies({ db, token }) {
  const { results } = await db
    .prepare(
      `SELECT m.tmdb_id, m.title, m.bom_slug
         FROM movies m
         WHERE (m.status = 'released' OR m.status = 'complete')
           AND EXISTS (
             SELECT 1 FROM owned_movies o
               WHERE o.tmdb_id = m.tmdb_id AND o.is_void = 0
           )`
    )
    .all();

  const now = new Date().toISOString();
  let moviesProcessed = 0;
  let moviesFailed = 0;
  let rowsInserted = 0;
  const failures = [];

  for (const row of results || []) {
    moviesProcessed += 1;
    let slug = row.bom_slug;
    if (!slug) {
      slug = await discoverBomSlug(row.tmdb_id, token);
      if (slug) {
        await db
          .prepare(`UPDATE movies SET bom_slug = ? WHERE tmdb_id = ?`)
          .bind(slug, row.tmdb_id).run();
      }
    }
    if (!slug) {
      moviesFailed += 1;
      failures.push({ tmdb_id: row.tmdb_id, title: row.title, reason: "no_slug" });
      continue;
    }
    try {
      const { rows, reason } = await scrapeWeeklyHistory(slug);
      if (!rows.length) {
        moviesFailed += 1;
        failures.push({ tmdb_id: row.tmdb_id, title: row.title, reason });
        continue;
      }
      for (const { date, cumulative } of rows) {
        await db.prepare(
          `INSERT INTO dailies (tmdb_id, date, domestic_revenue, source, scraped_at)
           VALUES (?, ?, ?, 'bom-weekly', ?)
           ON CONFLICT(tmdb_id, date) DO UPDATE SET
             domestic_revenue = CASE WHEN dailies.source = 'manual'
               THEN dailies.domestic_revenue ELSE excluded.domestic_revenue END,
             source = CASE WHEN dailies.source = 'manual'
               THEN dailies.source ELSE excluded.source END,
             scraped_at = excluded.scraped_at`
        ).bind(row.tmdb_id, date, cumulative, now).run();
        rowsInserted += 1;
      }
    } catch (e) {
      moviesFailed += 1;
      failures.push({
        tmdb_id: row.tmdb_id, title: row.title,
        reason: "fetch_error", error: String(e?.message || e),
      });
    }
    await sleep(1000);
  }

  return {
    movies_processed: moviesProcessed,
    movies_failed: moviesFailed,
    rows_inserted: rowsInserted,
    failures: failures.slice(0, 10),
  };
}

// Refresh dailies for every released movie. Writes one row per (tmdb_id, today)
// with source='bom'. Skips movies already scraped today, movies missing a slug
// (attempts discovery first), and failures (logged as no-op).
export async function refreshDailies({ db, token }) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // Only scrape dailies for movies we actually track (owned or currently
  // auctioned) — BOM is a slow, fragile dependency and there's no point
  // pulling revenue for the other ~250 titles in the catalog.
  const { results } = await db
    .prepare(
      `SELECT m.tmdb_id, m.title, m.bom_slug
         FROM movies m
         WHERE m.status = 'released'
           AND (
             EXISTS (SELECT 1 FROM owned_movies o WHERE o.tmdb_id = m.tmdb_id)
             OR EXISTS (SELECT 1 FROM auctions a WHERE a.tmdb_id = m.tmdb_id AND a.status = 'open')
           )
           AND NOT EXISTS (
             SELECT 1 FROM dailies d
               WHERE d.tmdb_id = m.tmdb_id AND d.date = ?
           )`
    )
    .bind(today)
    .all();

  let updated = 0;
  let noData = 0;
  let failed = 0;
  const failures = [];
  for (const row of results || []) {
    let slug = row.bom_slug;
    if (!slug) {
      slug = await discoverBomSlug(row.tmdb_id, token);
      if (slug) {
        await db
          .prepare(`UPDATE movies SET bom_slug = ? WHERE tmdb_id = ?`)
          .bind(slug, row.tmdb_id)
          .run();
      }
    }
    if (!slug) {
      failed += 1;
      failures.push({ tmdb_id: row.tmdb_id, title: row.title, reason: "no_slug" });
      continue;
    }
    try {
      const { revenue, noData: pageHasNoData } = await scrapeDomestic(slug);
      if (revenue != null) {
        await db
          .prepare(
            `INSERT INTO dailies (tmdb_id, date, domestic_revenue, source, scraped_at)
             VALUES (?, ?, ?, 'bom', ?)
             ON CONFLICT(tmdb_id, date) DO UPDATE SET
               domestic_revenue = excluded.domestic_revenue,
               source = excluded.source,
               scraped_at = excluded.scraped_at`
          )
          .bind(row.tmdb_id, today, revenue, now)
          .run();
        updated += 1;
      } else if (pageHasNoData) {
        noData += 1;
      } else {
        failed += 1;
        failures.push({ tmdb_id: row.tmdb_id, title: row.title, slug, reason: "parse_failed" });
      }
    } catch (e) {
      failed += 1;
      failures.push({ tmdb_id: row.tmdb_id, title: row.title, slug, reason: "fetch_error", error: String(e?.message || e) });
    }
    // Polite pacing between fetches.
    await sleep(1000);
  }
  return { updated, noData, failed, checked: results?.length || 0, failures: failures.slice(0, 5) };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
