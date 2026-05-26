import { settleIfAllPassed } from "../_settlement.js";
import {
  postAuctionStarted,
  postBidPlaced,
  postPassPlaced,
  postAuctionSettled,
} from "../_discord.js";

const DISCORD_PUBLIC_KEY = "c606c11537ec649f897e142db70be33fe1432084920be1a0f18ba9d694609be7";
const DEFAULT_AUCTION_DURATION_MS = 24 * 60 * 60 * 1000;
const EXTEND_MS = 5 * 60 * 1000;

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
      `SELECT id, username, points_remaining FROM users
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

      if (env.DISCORD_GAME_FEED_WEBHOOK_URL) {
        await fetch(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
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

      await postAuctionStarted(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
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
      const amount = rawAmount != null ? Number(rawAmount) : auction.current_bid + 1;
      if (!Number.isInteger(amount) || amount < 1) return ephemeral("Bid must be a whole number ≥ 1.");
      if (amount <= auction.current_bid) {
        return ephemeral(`The current bid is now **${auction.current_bid} pt${auction.current_bid !== 1 ? "s" : ""}** — bid at least **${auction.current_bid + 1}** to take the lead.`);
      }
      if ((leagueUser.points_remaining || 0) < amount) {
        return ephemeral(`Not enough points — you have **${leagueUser.points_remaining}** but the bid is **${amount}**.`);
      }

      const now = new Date().toISOString();
      const extended = new Date(Math.max(
        new Date(auction.ends_at).getTime(),
        Date.now() + EXTEND_MS
      )).toISOString();

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE auctions SET current_bid = ?, current_bidder_id = ?, ends_at = ? WHERE id = ? AND status = 'open'`
        ).bind(amount, leagueUser.id, extended, auction.id),
        env.DB.prepare(
          `INSERT INTO auction_bids (id, auction_id, user_id, amount, bid_at) VALUES (?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), auction.id, leagueUser.id, amount, now),
        env.DB.prepare(
          `DELETE FROM auction_passes WHERE auction_id = ? AND user_id = ?`
        ).bind(auction.id, leagueUser.id),
      ]);

      await postBidPlaced(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
        movieTitle: auction.movie_title,
        bidderDiscordId: discordUser.id,
        bidderUsername: leagueUser.username,
        amount,
      });

      const settleResult = await settleIfAllPassed(env.DB, auction.id);
      if (settleResult.settled) {
        await postAuctionSettled(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
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

      await postPassPlaced(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
        movieTitle: auction.movie_title,
        passerDiscordId: discordUser.id,
        passerUsername: leagueUser.username,
      });

      const settleResult = await settleIfAllPassed(env.DB, auction.id);
      if (settleResult.settled) {
        await postAuctionSettled(env.DISCORD_GAME_FEED_WEBHOOK_URL, {
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
  }

  return respond({ type: 1 });
}
