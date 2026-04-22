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
