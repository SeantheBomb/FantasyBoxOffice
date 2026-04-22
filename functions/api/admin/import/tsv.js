import { json, badRequest, requireAdmin } from "../../_auth";
import { hashPasswordPBKDF2 } from "../../_crypto";
import { parseTsv, normalizeTitle } from "../../_tsv";

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.tsv) return badRequest("Missing 'tsv' field");

  let parsed;
  try {
    parsed = parseTsv(body.tsv, { defaultYear: body.defaultYear || 2026 });
  } catch (e) {
    return badRequest(`Parse error: ${e.message}`);
  }

  const now = new Date().toISOString();
  const report = {
    players: { created: 0, matched: 0, placeholder_emails: [] },
    movies: { matched: 0, missing: [] },
    owned: { upserted: 0 },
    voided: 0,
    dailies: { upserted: 0 },
  };

  // Players: match by case-insensitive username or real_name. Create a
  // placeholder user for any player not already in the DB — the admin can
  // rename/reassign later. Placeholder email uses a .invalid TLD so it can
  // never collide with a real signup.
  const userMap = {}; // name → user_id
  for (const p of parsed.players) {
    const existing = await env.DB.prepare(
      `SELECT id FROM users
         WHERE LOWER(username) = LOWER(?) OR LOWER(real_name) = LOWER(?)
         LIMIT 1`
    ).bind(p.name, p.name).first();

    if (existing) {
      userMap[p.name] = existing.id;
      await env.DB.prepare(
        `UPDATE users SET points_remaining = ? WHERE id = ?`
      ).bind(p.remainingPoints, existing.id).run();
      report.players.matched += 1;
    } else {
      const id = crypto.randomUUID();
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const email = `${slug}@placeholder.invalid`;
      // Random password — the admin resets it when assigning to a real user.
      const randomPassword = crypto.randomUUID() + crypto.randomUUID();
      const { saltB64, hashB64 } = await hashPasswordPBKDF2(randomPassword);

      await env.DB.prepare(
        `INSERT INTO users (id, email, username, real_name, password_hash, password_salt, created_at, points_remaining)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, email, p.name, p.name, hashB64, saltB64, now, p.remainingPoints).run();
      userMap[p.name] = id;
      report.players.created += 1;
      report.players.placeholder_emails.push({ name: p.name, email });
    }
  }

  // Build a title-index for fuzzy title matching against the movies table.
  const { results: allMovies } = await env.DB.prepare(
    `SELECT tmdb_id, title, budget FROM movies`
  ).all();
  const titleIdx = new Map();
  for (const row of allMovies || []) {
    titleIdx.set(normalizeTitle(row.title), row);
  }

  for (const m of parsed.movies) {
    const key = normalizeTitle(m.title);
    const found = titleIdx.get(key);
    if (!found) {
      report.movies.missing.push(m.title);
      continue;
    }
    report.movies.matched += 1;

    // Fill budget from TSV if our row has none.
    if (m.budget && (!found.budget || found.budget === 0)) {
      await env.DB.prepare(
        `UPDATE movies SET budget = ? WHERE tmdb_id = ?`
      ).bind(m.budget, found.tmdb_id).run();
    }

    // Revenue → dailies row dated today, source='import'.
    if (m.revenue && m.revenue > 0) {
      const today = now.slice(0, 10);
      await env.DB.prepare(
        `INSERT INTO dailies (tmdb_id, date, domestic_revenue, source, scraped_at)
         VALUES (?, ?, ?, 'import', ?)
         ON CONFLICT(tmdb_id, date) DO UPDATE SET
           domestic_revenue = excluded.domestic_revenue,
           source = excluded.source,
           scraped_at = excluded.scraped_at`
      ).bind(found.tmdb_id, today, m.revenue, now).run();
      report.dailies.upserted += 1;
    }

    // Ownership: first bidder in the list is the owner. Create owned_movies.
    const owner = m.bids[0];
    if (owner) {
      const ownerId = userMap[owner.player];
      if (!ownerId) continue;
      await env.DB.prepare(
        `INSERT INTO owned_movies (tmdb_id, owner_user_id, purchase_price, is_void, acquired_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tmdb_id) DO UPDATE SET
           owner_user_id = excluded.owner_user_id,
           purchase_price = excluded.purchase_price,
           is_void = excluded.is_void`
      ).bind(found.tmdb_id, ownerId, owner.amount, m.isVoid ? 1 : 0, now).run();
      report.owned.upserted += 1;
      if (m.isVoid) report.voided += 1;
    }
  }

  return json({ ok: true, ...report });
}
