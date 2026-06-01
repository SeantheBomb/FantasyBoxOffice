import { settleIfAllPassed } from "../_settlement.js";
import { computeStandings } from "../game/_standings.js";
import {
  postAuctionStarted,
  postBidPlaced,
  postPassPlaced,
  postAuctionSettled,
  postMovieVoided,
} from "../_discord.js";

const DISCORD_PUBLIC_KEY = "c606c11537ec649f897e142db70be33fe1432084920be1a0f18ba9d694609be7";
const DEFAULT_AUCTION_DURATION_MS = 24 * 60 * 60 * 1000;

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function verifySignature(request) {
  const sig = request.headers.get("x-signature-ed25519");
  const ts = request.headers.get("x-signature-timestamp");
  if (!sig || !ts) return { valid: false, body: "" };

  const body = await request.text();
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(DISCORD_PUBLIC_KEY),
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "Ed25519",
    key,
    hexToBytes(sig),
    new TextEncoder().encode(ts + body)
  );
  return { valid, body };
}

function parseEstimate(input) {
  // Integer millions only: $45M or 45M. No decimals, no raw numbers.
  // Returns integer millions (e.g., 45 for $45M) — consistent with website form.
  const s = (input || "").trim().replace(/[$,\s]/g, "").toUpperCase();
  const match = s.match(/^(\d+)M$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (num <= 0) return null;
  return num;
}

function respond(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

function formatReleaseDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Ephemeral reply — only the user who ran the command sees it.
function ephemeral(content) {
  return respond({ type: 4, data: { content, flags: 64 } });
}

async function getActiveWeekend(db) {
  const row = await db
    .prepare(
      `SELECT DISTINCT weekend_date FROM weekend_movies
       WHERE weekend_date > date('now')
       ORDER BY weekend_date ASC LIMIT 1`
    )
    .first();
  return row?.weekend_date ?? null;
}

// Look up the league user linked to a Discord user ID.
async function getLeagueUser(db, discordUserId) {
  return db
    .prepare(
      `SELECT id, username, points_remaining, is_admin, discord_user_id FROM users
       WHERE discord_user_id = ? AND in_league = 1 LIMIT 1`
    )
    .bind(discordUserId)
    .first();
}

export async function onRequestPost({ request, env }) {
  const { valid, body } = await verifySignature(request);
  if (!valid) return new Response("Unauthorized", { status: 401 });

  const interaction = JSON.parse(body);

  // Discord PING — must respond immediately with PONG.
  if (interaction.type === 1) {
    return respond({ type: 1 });
  }

  // Autocomplete — route by command name.
  if (interaction.type === 4) {
    const cmdName = interaction.data?.name;

    if (cmdName === "bet") {
      const weekend = await getActiveWeekend(env.DB);
      if (!weekend) return respond({ type: 8, data: { choices: [] } });
      const focusedOption = interaction.data?.options?.find((o) => o.focused);
      const typed = (focusedOption?.value || "").trim();
      const { results } = await env.DB.prepare(
        `SELECT m.tmdb_id, m.title FROM weekend_movies wm
         JOIN movies m ON m.tmdb_id = wm.tmdb_id
         WHERE wm.weekend_date = ?
           AND (? = '' OR LOWER(m.title) LIKE '%' || LOWER(?) || '%')
         ORDER BY m.title LIMIT 25`
      )
        .bind(weekend, typed, typed)
        .all();
      return respond({
        type: 8,
        data: { choices: results.map((r) => ({ name: r.title, value: String(r.tmdb_id) })) },
      });
    }

    if (cmdName === "auction") {
      const focusedOption = interaction.data?.options?.find((o) => o.focused);
      const typed = (focusedOption?.value || "").trim();
      const { results } = await env.DB.prepare(
        `SELECT m.tmdb_id, m.title FROM movies m
         WHERE m.status = 'unreleased'
           AND (? = '' OR LOWER(m.title) LIKE '%' || LOWER(?) || '%')
           AND NOT EXISTS (SELECT 1 FROM owned_movies om WHERE om.tmdb_id = m.tmdb_id AND om.is_void = 0)
           AND NOT EXISTS (SELECT 1 FROM auctions a WHERE a.tmdb_id = m.tmdb_id AND a.status = 'open')
         ORDER BY m.title LIMIT 25`
      ).bind(typed, typed).all();
      return respond({
        type: 8,
        data: { choices: results.map((r) => ({ name: r.title, value: String(r.tmdb_id) })) },
      });
    }

    if (cmdName === "bid" || cmdName === "pass") {
      const { results } = await env.DB.prepare(
        `SELECT a.id, m.title, a.current_bid FROM auctions a
         JOIN movies m ON m.tmdb_id = a.tmdb_id
         WHERE a.status = 'open'
         ORDER BY m.title LIMIT 25`
      ).all();
      return respond({
        type: 8,
        data: {
          choices: results.map((r) => ({
            name: `${r.title} (current: ${r.current_bid} pt${r.current_bid !== 1 ? "s" : ""})`,
            value: r.id,
          })),
        },
      });
    }

    if (cmdName === "void") {
      const discordUser = interaction.member?.user ?? interaction.user;
      const leagueUser = await getLeagueUser(env.DB, discordUser.id);
      const focusedOption = interaction.data?.options?.find((o) => o.focused);
      const typed = (focusedOption?.value || "").trim();
      // Admins see all owned non-void movies; players see only their own.
      let query, binds;
      if (leagueUser?.is_admin) {
        query = `SELECT o.tmdb_id, m.title, u.username AS owner_username
                 FROM owned_movies o
                 JOIN movies m ON m.tmdb_id = o.tmdb_id
                 JOIN users u ON u.id = o.owner_user_id
                 WHERE o.is_void = 0
                   AND (? = '' OR LOWER(m.title) LIKE '%' || LOWER(?) || '%')
                 ORDER BY m.title LIMIT 25`;
        binds = [typed, typed];
      } else if (leagueUser) {
        query = `SELECT o.tmdb_id, m.title, u.username AS owner_username
                 FROM owned_movies o
                 JOIN movies m ON m.tmdb_id = o.tmdb_id
                 JOIN users u ON u.id = o.owner_user_id
                 WHERE o.is_void = 0 AND o.owner_user_id = ?
                   AND (? = '' OR LOWER(m.title) LIKE '%' || LOWER(?) || '%')
                 ORDER BY m.title LIMIT 25`;
        binds = [leagueUser.id, typed, typed];
      } else {
        return respond({ type: 8, data: { choices: [] } });
      }
      const { results } = await env.DB.prepare(query).bind(...binds).all();
      return respond({
        type: 8,
        data: {
          choices: results.map((r) => ({
            name: leagueUser.is_admin ? `${r.title} (${r.owner_username})` : r.title,
            value: String(r.tmdb_id),
          })),
        },
      });
    }

    return respond({ type: 8, data: { choices: [] } });
  }

  // Slash commands.
  if (interaction.type === 2) {
    const cmdName = interaction.data?.name;
    const discordUser = interaction.member?.user ?? interaction.user;

    // ── /bet ─────────────────────────────────────────────────────────────────
    if (cmdName === "bet") {
      const opts = Object.fromEntries(
        (interaction.data.options || []).map((o) => [o.name, o.value])
      );

      const estimate = parseEstimate(opts.estimate);
      if (!estimate) {
        return ephemeral("Bets must be a whole number in millions — e.g. `$45M` or `45M`. No decimals.");
      }

      const tmdbId = parseInt(opts.movie, 10);
      const weekend = await getActiveWeekend(env.DB);
      if (!weekend) {
        return ephemeral("Betting is closed — movies are already in theaters or no upcoming weekend is configured. Check back Monday!");
      }

      const movie = await env.DB.prepare(
        `SELECT m.title FROM weekend_movies wm
         JOIN movies m ON m.tmdb_id = wm.tmdb_id
         WHERE wm.weekend_date = ? AND wm.tmdb_id = ?`
      )
        .bind(weekend, tmdbId)
        .first();

      if (!movie) {
        return ephemeral("That movie isn't in this weekend's lineup.");
      }

      // Check both formats: existing picks may be raw dollars (old) or integer millions (new).
      const taken = await env.DB.prepare(
        `SELECT discord_username FROM weekend_picks
         WHERE tmdb_id = ? AND weekend_date = ?
           AND (estimate = ? OR estimate = ?)
           AND discord_user_id != ?
         LIMIT 1`
      )
        .bind(tmdbId, weekend, estimate, estimate * 1_000_000, discordUser.id)
        .first();
      if (taken) {
        return ephemeral(
          `**$${estimate}M** is already taken by another player — pick a different amount!`
        );
      }

      await env.DB.prepare(
        `INSERT INTO weekend_picks (discord_user_id, discord_username, tmdb_id, estimate, weekend_date)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(discord_user_id, tmdb_id, weekend_date)
         DO UPDATE SET estimate = excluded.estimate, discord_username = excluded.discord_username`
      )
        .bind(discordUser.id, discordUser.global_name ?? discordUser.username, tmdbId, estimate, weekend)
        .run();

      if (env.DISCORD_WEBHOOK_URL) {
        await fetch(env.DISCORD_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `🎲 <@${discordUser.id}> bet **$${estimate}M** on **${movie.title}**`,
          }),
        }).catch(() => {});
      }

      return ephemeral(`Bet locked in: **${movie.title}** — $${estimate}M`);
    }

    // ── /auction ──────────────────────────────────────────────────────────────
    if (cmdName === "auction") {
      const opts = Object.fromEntries(
        (interaction.data.options || []).map((o) => [o.name, o.value])
      );

      const leagueUser = await getLeagueUser(env.DB, discordUser.id);
      if (!leagueUser) {
        return ephemeral(
          "Your Discord account isn't linked to a league account yet. Log in at https://fantasyboxoffice.pages.dev/ and visit **My Account** to link your Discord ID."
        );
      }

      const tmdbId = parseInt(opts.movie, 10);
      const startingBid = Number(opts.starting_bid ?? 1);
      if (!Number.isInteger(startingBid) || startingBid < 1) {
        return ephemeral("Starting bid must be a whole number ≥ 1.");
      }

      const movie = await env.DB.prepare(
        `SELECT tmdb_id, title, status, release_date, poster_url FROM movies WHERE tmdb_id = ?`
      ).bind(tmdbId).first();
      if (!movie) return ephemeral("Movie not found.");
      if (movie.status !== "unreleased") return ephemeral("That movie has already been released and can't be auctioned.");

      const existingOwner = await env.DB.prepare(
        `SELECT tmdb_id FROM owned_movies WHERE tmdb_id = ? AND is_void = 0`
      ).bind(tmdbId).first();
      if (existingOwner) return ephemeral("That movie is already owned.");

      const existingAuction = await env.DB.prepare(
        `SELECT id FROM auctions WHERE tmdb_id = ? AND status = 'open'`
      ).bind(tmdbId).first();
      if (existingAuction) return ephemeral("An auction is already open for that movie.");

      if ((leagueUser.points_remaining || 0) < startingBid) {
        return ephemeral(`Not enough points — you have **${leagueUser.points_remaining}** but the starting bid is **${startingBid}**.`);
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const endsAt = new Date(Date.now() + DEFAULT_AUCTION_DURATION_MS).toISOString();

      await env.DB.prepare(
        `INSERT INTO auctions
           (id, tmdb_id, status, current_bid, current_bidder_id, started_by_user_id, ends_at, created_at)
         VALUES (?, ?, 'open', ?, ?, ?, ?, ?)`
      ).bind(id, tmdbId, startingBid, leagueUser.id, leagueUser.id, endsAt, now).run();

      await env.DB.prepare(
        `INSERT INTO auction_bids (id, auction_id, user_id, amount, bid_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), id, leagueUser.id, startingBid, now).run();

      await postAuctionStarted(env.DISCORD_WEBHOOK_URL, {
        movieTitle: movie.title,
        posterUrl: movie.poster_url,
        endsAt,
        startingBid,
        starterUsername: leagueUser.username,
      });

      return ephemeral(`Auction started for **${movie.title}** at **${startingBid} pt${startingBid !== 1 ? "s" : ""}**. Check #game-feed!`);
    }

    // ── /bid ──────────────────────────────────────────────────────────────────
    if (cmdName === "bid") {
      const opts = Object.fromEntries(
        (interaction.data.options || []).map((o) => [o.name, o.value])
      );

      const leagueUser = await getLeagueUser(env.DB, discordUser.id);
      if (!leagueUser) {
        return ephemeral(
          "Your Discord account isn't linked to a league account yet. Log in at https://fantasyboxoffice.pages.dev/ and visit **My Account** to link your Discord ID."
        );
      }

      const auctionId = opts.movie; // value is auction UUID from autocomplete
      const auction = await env.DB.prepare(
        `SELECT a.id, a.status, a.current_bid, a.current_bidder_id, a.ends_at,
                m.title AS movie_title, m.poster_url, m.release_date
           FROM auctions a
           JOIN movies m ON m.tmdb_id = a.tmdb_id
           WHERE a.id = ? LIMIT 1`
      ).bind(auctionId).first();

      if (!auction) return ephemeral("Auction not found.");
      if (auction.status !== "open") return ephemeral("That auction is no longer open.");
      if (new Date(auction.ends_at).getTime() <= Date.now()) return ephemeral("That auction has ended.");

      // Default amount = current_bid + 1 if not provided.
      const rawAmount = opts.amount;

      // Catch users typing "pass" in the amount field and redirect them.
      if (rawAmount != null && /^pass/i.test(rawAmount.trim())) {
        return ephemeral(
          `To pass on **${auction.movie_title}**, use the \`/pass\` command instead — select the same movie from the autocomplete and you'll be opted out without placing a bid.`
        );
      }

      const amount = rawAmount != null ? Number(rawAmount) : auction.current_bid + 1;
      if (!Number.isInteger(amount) || amount < 1) return ephemeral("Bid must be a whole number ≥ 1.");
      if (amount <= auction.current_bid) {
        return ephemeral(`The current bid is now **${auction.current_bid} pt${auction.current_bid !== 1 ? "s" : ""}** — bid at least **${auction.current_bid + 1}** to take the lead.`);
      }
      if ((leagueUser.points_remaining || 0) < amount) {
        return ephemeral(`Not enough points — you have **${leagueUser.points_remaining}** but the bid is **${amount}**.`);
      }

      const now = new Date().toISOString();
      const newEndsAt = new Date(Date.now() + DEFAULT_AUCTION_DURATION_MS).toISOString();

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE auctions SET current_bid = ?, current_bidder_id = ?, ends_at = ?, warning_sent_at = NULL WHERE id = ? AND status = 'open'`
        ).bind(amount, leagueUser.id, newEndsAt, auction.id),
        env.DB.prepare(
          `INSERT INTO auction_bids (id, auction_id, user_id, amount, bid_at) VALUES (?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), auction.id, leagueUser.id, amount, now),
        env.DB.prepare(
          `DELETE FROM auction_passes WHERE auction_id = ? AND user_id = ?`
        ).bind(auction.id, leagueUser.id),
      ]);

      await postBidPlaced(env.DISCORD_WEBHOOK_URL, {
        movieTitle: auction.movie_title,
        bidderDiscordId: discordUser.id,
        bidderUsername: leagueUser.username,
        amount,
        endsAt: newEndsAt,
      });

      const settleResult = await settleIfAllPassed(env.DB, auction.id);
      if (settleResult.settled) {
        await postAuctionSettled(env.DISCORD_WEBHOOK_URL, {
          movieTitle: settleResult.movieTitle,
          posterUrl: settleResult.posterUrl,
          releaseDate: settleResult.releaseDate,
          winnerDiscordId: settleResult.winnerDiscordId,
          winnerUsername: settleResult.winnerUsername,
          amount: settleResult.price,
        });
        return ephemeral(`Bid placed — and since everyone else passed, **${auction.movie_title}** is now yours for **${amount} pt${amount !== 1 ? "s" : ""}**! Check #game-feed.`);
      }

      return ephemeral(`Bid of **${amount} pt${amount !== 1 ? "s" : ""}** on **${auction.movie_title}** placed. Check #game-feed!`);
    }

    // ── /points ───────────────────────────────────────────────────────────────
    if (cmdName === "points") {
      const { results } = await env.DB.prepare(
        `SELECT username, points_remaining FROM users
         WHERE in_league = 1
         ORDER BY points_remaining DESC`
      ).all();

      if (!results.length) {
        return respond({ type: 4, data: { content: "No league players found." } });
      }

      const lines = results.map(
        (u, i) => `${i + 1}. **${u.username}** — ${u.points_remaining} pts`
      );
      return respond({
        type: 4,
        data: { content: `**Points remaining:**\n${lines.join("\n")}` },
      });
    }

    // ── /pass ─────────────────────────────────────────────────────────────────
    if (cmdName === "pass") {
      const opts = Object.fromEntries(
        (interaction.data.options || []).map((o) => [o.name, o.value])
      );

      const leagueUser = await getLeagueUser(env.DB, discordUser.id);
      if (!leagueUser) {
        return ephemeral(
          "Your Discord account isn't linked to a league account yet. Log in at https://fantasyboxoffice.pages.dev/ and visit **My Account** to link your Discord ID."
        );
      }

      const auctionId = opts.movie; // value is auction UUID from autocomplete
      const auction = await env.DB.prepare(
        `SELECT a.id, a.status, a.current_bidder_id,
                m.title AS movie_title, m.poster_url, m.release_date
           FROM auctions a
           JOIN movies m ON m.tmdb_id = a.tmdb_id
           WHERE a.id = ? LIMIT 1`
      ).bind(auctionId).first();

      if (!auction) return ephemeral("Auction not found.");
      if (auction.status !== "open") return ephemeral("That auction is no longer open.");
      if (auction.current_bidder_id === leagueUser.id) {
        return ephemeral("You're the current high bidder — you can't pass. Place a new bid if you want to stay in.");
      }

      await env.DB.prepare(
        `INSERT INTO auction_passes (auction_id, user_id, passed_at)
         VALUES (?, ?, ?)
         ON CONFLICT(auction_id, user_id) DO NOTHING`
      ).bind(auction.id, leagueUser.id, new Date().toISOString()).run();

      await postPassPlaced(env.DISCORD_WEBHOOK_URL, {
        movieTitle: auction.movie_title,
        passerDiscordId: discordUser.id,
        passerUsername: leagueUser.username,
      });

      const settleResult = await settleIfAllPassed(env.DB, auction.id);
      if (settleResult.settled) {
        await postAuctionSettled(env.DISCORD_WEBHOOK_URL, {
          movieTitle: settleResult.movieTitle,
          posterUrl: settleResult.posterUrl,
          releaseDate: settleResult.releaseDate,
          winnerDiscordId: settleResult.winnerDiscordId,
          winnerUsername: settleResult.winnerUsername,
          amount: settleResult.price,
        });
        return ephemeral(`Passed on **${auction.movie_title}** — and with everyone else out, it's been awarded to the last bidder. Check #game-feed.`);
      }

      return ephemeral(`Passed on **${auction.movie_title}**. You won't be able to bid on this movie again.`);
    }

    // ── /void ─────────────────────────────────────────────────────────────────
    if (cmdName === "void") {
      const leagueUser = await getLeagueUser(env.DB, discordUser.id);
      if (!leagueUser) {
        return ephemeral(
          "Your Discord account isn't linked to a league account yet. Log in at https://fantasyboxoffice.pages.dev/ and visit **My Account** to link your Discord ID."
        );
      }

      const opts = Object.fromEntries(
        (interaction.data.options || []).map((o) => [o.name, o.value])
      );
      const tmdbId = parseInt(opts.movie, 10);
      if (!tmdbId) return ephemeral("Please select a movie from the list.");

      const row = await env.DB.prepare(
        `SELECT o.tmdb_id, o.owner_user_id, o.purchase_price, o.is_void,
                m.title, m.poster_url,
                u.username AS owner_username, u.discord_user_id AS owner_discord_id,
                u.points_remaining AS owner_points
         FROM owned_movies o
         JOIN movies m ON m.tmdb_id = o.tmdb_id
         JOIN users u ON u.id = o.owner_user_id
         WHERE o.tmdb_id = ? LIMIT 1`
      ).bind(tmdbId).first();

      if (!row) return ephemeral("That movie isn't owned by anyone.");
      if (row.is_void) return ephemeral("That movie is already void.");

      if (!leagueUser.is_admin && row.owner_user_id !== leagueUser.id) {
        return ephemeral("You can only void movies you own.");
      }

      const voidCost = 2 * row.purchase_price;
      if ((row.owner_points || 0) < voidCost) {
        const msg = leagueUser.is_admin
          ? `**${row.owner_username}** only has **${row.owner_points} pts** — need **${voidCost}** to void **${row.title}** (2× purchase price of ${row.purchase_price} pts).`
          : `You need **${voidCost} pts** to void **${row.title}** (2× its purchase price of ${row.purchase_price} pts), but you only have **${row.owner_points}**.`;
        return ephemeral(msg);
      }

      await env.DB.batch([
        env.DB.prepare(`UPDATE owned_movies SET is_void = 1 WHERE tmdb_id = ?`).bind(tmdbId),
        env.DB.prepare(`UPDATE users SET points_remaining = points_remaining - ? WHERE id = ?`)
          .bind(voidCost, row.owner_user_id),
      ]);

      try {
        const standings = await computeStandings(env.DB);
        const ownerIndex = standings.users.findIndex((u) => u.id === row.owner_user_id);
        const ownerStanding = ownerIndex >= 0 ? { ...standings.users[ownerIndex], place: ownerIndex + 1 } : null;
        await postMovieVoided(env.DISCORD_WEBHOOK_URL, {
          movieTitle: row.title,
          posterUrl: row.poster_url,
          ownerUsername: row.owner_username,
          ownerDiscordId: row.owner_discord_id,
          ownerStanding,
          voidCost,
        });
      } catch (e) {
        console.error("Discord void announcement failed:", e);
      }

      if (leagueUser.is_admin) {
        return ephemeral(`Voided **${row.title}** (owned by ${row.owner_username}) — **${voidCost} pts** deducted from their balance. Announcement posted.`);
      }
      return ephemeral(`Voided **${row.title}** — **${voidCost} pts** deducted. Announcement posted.`);
    }

    // ── /upcoming ─────────────────────────────────────────────────────────────
    if (cmdName === "upcoming") {
      const { results } = await env.DB.prepare(
        `SELECT
           m.tmdb_id, m.title, m.release_date, m.poster_url, m.popularity, m.overview,
           CASE WHEN om.tmdb_id IS NOT NULL THEN 1 ELSE 0 END AS is_owned,
           u.username AS owner_username
         FROM movies m
         LEFT JOIN owned_movies om ON om.tmdb_id = m.tmdb_id AND om.is_void = 0
         LEFT JOIN users u ON u.id = om.owner_user_id
         WHERE m.release_date >= date('now')
           AND m.release_date <= date('now', '+56 days')
         ORDER BY m.release_date ASC, is_owned ASC, m.popularity DESC
         LIMIT 50`
      ).all();

      if (!results.length) {
        return respond({ type: 4, data: { content: "No movies found releasing in the next 8 weeks." } });
      }

      const unowned = results.filter((m) => !m.is_owned);
      const owned = results.filter((m) => m.is_owned);

      const embeds = unowned.slice(0, 10).map((m) => {
        const synopsis = m.overview
          ? m.overview.length > 150 ? m.overview.slice(0, 147) + "…" : m.overview
          : "";
        return {
          title: m.title,
          description: synopsis || undefined,
          color: 0x57f287,
          thumbnail: m.poster_url ? { url: m.poster_url } : undefined,
          fields: [
            { name: "Release", value: formatReleaseDate(m.release_date), inline: true },
            { name: "Popularity", value: String(Math.round(m.popularity)), inline: true },
          ],
        };
      });

      const lines = [`**Upcoming movies — next 8 weeks**`];
      if (unowned.length === 0) {
        lines.push("All upcoming movies are already owned.");
      } else {
        lines.push(`**${unowned.length}** available to auction${unowned.length > 10 ? ` (showing first 10 below)` : ""}:`);
      }

      if (owned.length > 0) {
        lines.push(`\n**Owned:**`);
        for (const m of owned) {
          lines.push(`• **${m.title}** (${formatReleaseDate(m.release_date)}) — ${m.owner_username}`);
        }
      }

      return respond({ type: 4, data: { content: lines.join("\n"), embeds } });
    }
  }

  return respond({ type: 1 });
}
