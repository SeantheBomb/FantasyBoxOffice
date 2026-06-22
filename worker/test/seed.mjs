// Test data for the standings job local test.
// Scenario: 3 league users, 5 movies (2 released + owned, 1 released + unowned,
// 1 unreleased + owned, 1 complete + owned). Last weekend had 1 movie in
// weekend_movies with 3 picks, no weekend_results yet (triggers auto-scoring).
// A future weekend_movies entry exists to trigger the announcement.

// "Last Friday" relative to when the test runs — the scoring query uses
// date('now', '-3 days') so we need weekend_date within that window.
function lastFriday() {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day + 2) % 7; // days since last Friday
  d.setUTCDate(d.getUTCDate() - (diff || 7));
  return d.toISOString().slice(0, 10);
}

function nextFriday() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (5 - day + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function seedDatabase(db) {
  const wkDate = lastFriday();
  const futureWk = nextFriday();
  const now = new Date().toISOString();

  // Users
  db.exec(`
    INSERT INTO users (id, email, username, real_name, password_hash, password_salt, is_admin, points_remaining, in_league, discord_user_id, created_at)
    VALUES
      ('u1', 'alice@test.com', 'Alice', 'Alice A', 'hash', 'salt', 0, 50, 1, '111111111111111111', '${now}'),
      ('u2', 'bob@test.com', 'Bob', 'Bob B', 'hash', 'salt', 0, 40, 1, '222222222222222222', '${now}'),
      ('u3', 'carol@test.com', 'Carol', 'Carol C', 'hash', 'salt', 0, 30, 1, '333333333333333333', '${now}');
  `);

  // Movies
  db.exec(`
    INSERT INTO movies (tmdb_id, title, release_date, budget, budget_is_placeholder, poster_url, status, bom_slug, popularity, overview, created_at)
    VALUES
      (1001, 'Scored Movie', '${wkDate}', 80000000, 0, 'https://img/poster1.jpg', 'released', 'tt0001', 50, 'A test movie', '${now}'),
      (1002, 'Other Released', '${daysAgo(30)}', 100000000, 0, 'https://img/poster2.jpg', 'released', 'tt0002', 40, 'Another movie', '${now}'),
      (1003, 'Unowned Movie', '${daysAgo(20)}', 60000000, 0, 'https://img/poster3.jpg', 'released', 'tt0003', 30, 'Unowned', '${now}'),
      (1004, 'Unreleased Film', '${futureWk}', 120000000, 1, 'https://img/poster4.jpg', 'unreleased', NULL, 20, 'Coming soon', '${now}'),
      (1005, 'Finished Film', '${daysAgo(90)}', 50000000, 0, 'https://img/poster5.jpg', 'complete', 'tt0005', 10, 'Done', '${now}');
  `);

  // Owned movies (Alice owns 1001+1002, Bob owns 1004+1005, Carol owns nothing via auction)
  db.exec(`
    INSERT INTO owned_movies (tmdb_id, owner_user_id, purchase_price, is_void, acquired_at)
    VALUES
      (1001, 'u1', 10, 0, '${now}'),
      (1002, 'u1', 15, 0, '${now}'),
      (1004, 'u2', 8, 0, '${now}'),
      (1005, 'u2', 5, 0, '${now}');
  `);

  // Dailies — revenue snapshots for the released movies
  // Movie 1001 (Scored Movie): opened last weekend, $44M cumulative by Sunday
  db.exec(`
    INSERT INTO dailies (tmdb_id, date, domestic_revenue, source, scraped_at)
    VALUES
      (1001, '${wkDate}', 19200000, 'bom-weekly', '${now}'),
      (1001, '${daysAgo(daysSinceFriday() - 1)}', 33000000, 'bom-weekly', '${now}'),
      (1001, '${daysAgo(daysSinceFriday() - 2)}', 44000000, 'bom-weekly', '${now}'),

      (1002, '${daysAgo(30)}', 75000000, 'bom-weekly', '${now}'),
      (1002, '${daysAgo(23)}', 120000000, 'bom-weekly', '${now}'),
      (1002, '${daysAgo(16)}', 150000000, 'bom-weekly', '${now}'),
      (1002, '${daysAgo(9)}', 165000000, 'bom-weekly', '${now}'),
      (1002, '${today()}', 170000000, 'bom', '${now}'),

      (1005, '${daysAgo(90)}', 100000000, 'bom-weekly', '${now}'),
      (1005, '${daysAgo(60)}', 140000000, 'bom-weekly', '${now}'),
      (1005, '${today()}', 145000000, 'bom', '${now}');
  `);

  // Weekend movies — last weekend + next weekend
  db.exec(`
    INSERT INTO weekend_movies (tmdb_id, weekend_date)
    VALUES
      (1001, '${wkDate}'),
      (1004, '${futureWk}');
  `);

  // Weekend picks — 3 users bet on movie 1001 last weekend
  // Actual gross will be $44M. Alice=$45M (closest), Bob=$30M, Carol=$50M
  db.exec(`
    INSERT INTO weekend_picks (discord_user_id, discord_username, tmdb_id, estimate, weekend_date)
    VALUES
      ('111111111111111111', 'Alice', 1001, 45, '${wkDate}'),
      ('222222222222222222', 'Bob', 1001, 30, '${wkDate}'),
      ('333333333333333333', 'Carol', 1001, 50, '${wkDate}');
  `);

  return { wkDate, futureWk };
}

function daysSinceFriday() {
  const d = new Date();
  const day = d.getUTCDay();
  return (day + 2) % 7 || 7;
}

// Canned fetch responses for BOM, TMDB, QuickChart, Discord
export function createFetchStub(discordCapture) {
  return async function fakeFetch(url, init) {
    const urlStr = typeof url === "string" ? url : url.toString();

    // Discord webhook — capture the call
    if (urlStr.includes("discord.com/api/webhooks") || urlStr.includes("localhost:9999")) {
      const body = init?.body;
      let parsed = null;
      if (typeof body === "string") {
        try { parsed = JSON.parse(body); } catch {}
      } else if (body instanceof FormData || (body && typeof body.getAll === "function")) {
        parsed = { formData: true };
      }
      discordCapture.push({ url: urlStr, method: init?.method, body: parsed, raw: body });
      return new Response(JSON.stringify({ id: "mock-msg-id" }), { status: 200 });
    }

    // QuickChart — return a tiny valid PNG
    if (urlStr.includes("quickchart.io")) {
      const png = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
        0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
        0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
        0x44, 0xAE, 0x42, 0x60, 0x82,
      ]);
      return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
    }

    // BOM pages — return empty HTML (backfill/refresh will get "no data" which is fine,
    // we pre-seeded the dailies table so scoring doesn't depend on live scraping)
    if (urlStr.includes("boxofficemojo.com")) {
      return new Response("<html><body>No data</body></html>", { status: 200 });
    }

    // TMDB API — return minimal valid responses
    if (urlStr.includes("api.themoviedb.org")) {
      if (urlStr.includes("/movie/")) {
        return new Response(JSON.stringify({ id: 1001, imdb_id: "tt0001", budget: 80000000 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/discover/")) {
        return new Response(JSON.stringify({ results: [], total_pages: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }

    // Fallback
    console.warn(`[fetch-stub] unhandled URL: ${urlStr}`);
    return new Response("Not Found", { status: 404 });
  };
}
