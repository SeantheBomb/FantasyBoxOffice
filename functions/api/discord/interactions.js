import { formatShort } from "../_format.js";

const DISCORD_PUBLIC_KEY = "c606c11537ec649f897e142db70be33fe1432084920be1a0f18ba9d694609be7";

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
  const s = (input || "").trim().replace(/[$,\s]/g, "").toUpperCase();
  const match = s.match(/^([\d.]+)([MB]?)$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (isNaN(num) || num <= 0) return null;
  if (match[2] === "B") return Math.round(num * 1_000_000_000);
  if (match[2] === "M") return Math.round(num * 1_000_000);
  return Math.round(num);
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
  // Betting closes when the weekend arrives (movies hit theaters Friday).
  // Use strict > so bets are locked out on release day itself.
  const row = await db
    .prepare(
      `SELECT DISTINCT weekend_date FROM weekend_movies
       WHERE weekend_date > date('now')
       ORDER BY weekend_date ASC LIMIT 1`
    )
    .first();
  return row?.weekend_date ?? null;
}

export async function onRequestPost({ request, env }) {
  const { valid, body } = await verifySignature(request);
  if (!valid) return new Response("Unauthorized", { status: 401 });

  const interaction = JSON.parse(body);

  // Discord PING — must respond immediately with PONG.
  if (interaction.type === 1) {
    return respond({ type: 1 });
  }

  // Autocomplete — return this weekend's movie list.
  if (interaction.type === 4) {
    const weekend = await getActiveWeekend(env.DB);
    if (!weekend) return respond({ type: 8, data: { choices: [] } });

    const { results } = await env.DB.prepare(
      `SELECT m.tmdb_id, m.title FROM weekend_movies wm
       JOIN movies m ON m.tmdb_id = wm.tmdb_id
       WHERE wm.weekend_date = ?
       ORDER BY m.title`
    )
      .bind(weekend)
      .all();

    const choices = results.map((r) => ({
      name: r.title,
      value: String(r.tmdb_id),
    }));
    return respond({ type: 8, data: { choices } });
  }

  // Slash command: /bet
  if (interaction.type === 2 && interaction.data?.name === "bet") {
    const opts = Object.fromEntries(
      (interaction.data.options || []).map((o) => [o.name, o.value])
    );

    const estimate = parseEstimate(opts.estimate);
    if (!estimate) {
      return ephemeral("Invalid estimate. Try `$45M`, `45M`, or `45000000`.");
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

    const user = interaction.member?.user ?? interaction.user;
    await env.DB.prepare(
      `INSERT INTO weekend_picks (discord_user_id, discord_username, tmdb_id, estimate, weekend_date)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(discord_user_id, tmdb_id, weekend_date)
       DO UPDATE SET estimate = excluded.estimate, discord_username = excluded.discord_username`
    )
      .bind(user.id, user.global_name ?? user.username, tmdbId, estimate, weekend)
      .run();

    return ephemeral(`Bet locked in: **${movie.title}** — ${formatShort(estimate)}`);
  }

  return respond({ type: 1 });
}
