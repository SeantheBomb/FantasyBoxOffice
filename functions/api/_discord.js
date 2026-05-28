// Discord helpers: builds the weekly standings markdown, assembles the
// Chart.js config for the profit chart, renders it to PNG via QuickChart,
// and posts the combined content to a Discord webhook.

import { formatShort, ordinalPlace } from "./_format.js";

const PALETTE = [
  "#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6",
  "#f97316", "#06b6d4", "#ec4899", "#84cc16", "#6366f1",
];

// Build the standings markdown. Returns an array of messages — each under
// Discord's 2000-char content limit. Splits at user boundaries so no user
// entry is broken across messages.
export function buildStandingsMarkdown(standings) {
  const users = standings.users || [];
  // Compute the "new release" cutoff once: movies that released in the past
  // 7 days are flagged as opening weekend debuts in the Discord post.
  const today = new Date();
  const newReleaseCutoff = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const blocks = users.map((u, idx) => formatUserBlock(u, idx + 1, newReleaseCutoff));
  const chunks = [];
  let current = "";
  for (const block of blocks) {
    if (current && current.length + block.length + 2 > 1900) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + block;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : ["_No players yet._"];
}

function formatUserBlock(user, place, newReleaseCutoff) {
  const header = `# ${user.username} => Total Profit = ${formatShort(user.total_profit)} *(${ordinalPlace(place)} Place)*`;
  // Skip unreleased movies — they have no revenue yet and just clutter the recap.
  const visible = (user.movies || []).filter((m) => m.status !== "unreleased");
  const lines = visible.map((m) => formatMovieLine(m, newReleaseCutoff));
  return [header, ...lines].join("\n");
}

function formatMovieLine(m, newReleaseCutoff) {
  const revenue = formatShort(m.revenue || 0);
  const budget = formatShort(m.budget || 0) + (m.budget_is_placeholder ? " *(est.)*" : "");
  const profitNum = Number(m.profit) || 0;
  const profitStr = profitNum < 0
    ? `*${formatShort(profitNum)}*`
    : `**${formatShort(profitNum)}**`;

  if (m.is_void) {
    // Voided: strike through the whole line, italicize the title, tag it.
    return `* ~~*${m.title}* => ${revenue} - ${budget} = ${profitStr}~~ *(VOID)*`;
  }
  if (m.status === "complete") {
    // Out of theaters: plain title (no bold), trailing tag.
    return `* ${m.title} => ${revenue} - ${budget} = ${profitStr} *(Out of theaters)*`;
  }

  // Determine the trailing tag: opening weekend debut vs week-over-week delta.
  let tag = "";
  if (newReleaseCutoff && m.release_date && m.release_date >= newReleaseCutoff) {
    tag = " *(New Release!)*";
  } else if (m.prev_revenue != null) {
    const delta = (m.revenue || 0) - m.prev_revenue;
    if (delta !== 0) tag = ` *(${delta >= 0 ? "+" : ""}${formatShort(delta)})*`;
  }

  return `* **${m.title}** => ${revenue} - ${budget} = ${profitStr}${tag}`;
}

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Chart.js config for the weekly profit chart. Returns a JavaScript object
// literal STRING (not a plain JS object) so that QuickChart can eval the
// ticks.callback function. QuickChart only evals callbacks when `chart` is
// sent as a string — when it's a JSON object the functions are already parsed
// as inert strings and never executed.
//
// Pure data (labels, datasets) is interpolated via JSON.stringify so special
// characters are safe. The callback is written as a real JS function literal.
export function buildChartConfig(history) {
  const { dates = [], series = [], releaseWeeks = {} } = history || {};

  // Primary x-axis: movie title at release week, empty string otherwise.
  const movieLabels = dates.map((d) => {
    const entries = releaseWeeks[d];
    if (!entries?.length) return "";
    return entries.map((e) => (e.title.length > 16 ? e.title.slice(0, 14) + "…" : e.title)).join(" / ");
  });

  // Secondary x-axis: month abbreviation at the first Sunday of each month.
  const monthLabels = dates.map((d) => {
    const parts = d.split("-");
    return Number(parts[2]) <= 7 ? MONTH_ABBR[Number(parts[1]) - 1] : "";
  });

  const datasets = series.map((s, i) => ({
    label: s.username,
    data: s.points,
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: "transparent",
    borderWidth: 2.5,
    pointRadius: 0,
    tension: 0.1,
  }));

  return `{
    type: 'line',
    data: {
      labels: ${JSON.stringify(movieLabels)},
      datasets: ${JSON.stringify(datasets)}
    },
    options: {
      plugins: {
        title: { display: true, text: 'Total Profit', font: { size: 20 } },
        legend: { position: 'top' }
      },
      scales: {
        x: { ticks: { maxRotation: 65, minRotation: 65, autoSkip: false } },
        months: {
          type: 'category',
          labels: ${JSON.stringify(monthLabels)},
          position: 'bottom',
          display: true,
          grid: { display: false, drawTicks: false },
          ticks: { maxRotation: 0, minRotation: 0, autoSkip: false, font: { weight: 'bold' } }
        },
        y: {
          display: true,
          ticks: {
            display: true,
            callback: function(v) {
              var a = Math.abs(v), p = v < 0 ? '-$' : '$';
              if (a >= 1e9) return p + (a / 1e9).toFixed(1) + 'B';
              return p + Math.round(a / 1e6) + 'M';
            }
          }
        }
      }
    }
  }`;
}

// POST the chart config to QuickChart, return PNG bytes. The `chart` field
// must be a JSON object (not a stringified one) — QuickChart parses callbacks
// out of any string property whose value begins with "function" or "()=>".
export async function renderChartPng(config) {
  const body = {
    chart: config,
    width: 1000,
    height: 600,
    backgroundColor: "white",
    format: "png",
    version: "4",
  };
  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QuickChart ${res.status}: ${text || res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// Post to a Discord webhook. `messages` is the array from
// buildStandingsMarkdown — first message carries the chart attachment,
// any overflow messages follow as plain content.
export async function postToWebhook(webhookUrl, { messages, pngBytes, filename = "standings.png" }) {
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL not set");

  const [first, ...rest] = messages;
  await postOne(webhookUrl, { content: first, pngBytes, filename });
  for (const content of rest) {
    await postOne(webhookUrl, { content });
  }
}

// Post the upcoming weekend's movie lineup to a Discord channel as embeds —
// one embed per movie with poster, title, and owner. Includes /bet instructions.
export async function postWeekendAnnouncement(webhookUrl, { weekendDate, movies }) {
  if (!webhookUrl) throw new Error("webhook URL not set");

  const [, m, d] = weekendDate.split("-");
  const dateStr = `${MONTH_ABBR[Number(m) - 1]} ${Number(d)}`;
  const content = `@everyone\n## 🎬 Opening Weekend — ${dateStr}\nHow much will each of these movies earn on their opening weekend? Use \`/bet\` to submit your prediction for each one!`;

  const embeds = movies.map((movie) => ({
    title: movie.title,
    description: `Owned by **${movie.owner}**`,
    color: 0xf59e0b,
    ...(movie.poster_url ? { image: { url: movie.poster_url } } : {}),
  }));

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, embeds }),
  });
  if (!res.ok) {
    throw new Error(`Discord ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
}

// ── Auction notifications ────────────────────────────────────────────────────

export async function postAuctionStarted(webhookUrl, { movieTitle, posterUrl, endsAt, startingBid, starterUsername }) {
  if (!webhookUrl) return;
  const unixSec = Math.floor(new Date(endsAt).getTime() / 1000);
  const embed = {
    title: `🎬 New Auction: ${movieTitle}`,
    description: [
      `**${starterUsername}** opened an auction with a starting bid of **${startingBid} pt${startingBid !== 1 ? "s" : ""}**`,
      ``,
      `**Closes:** <t:${unixSec}:F> (<t:${unixSec}:R>)`,
      ``,
      `Use \`/bid\` to raise the bid, or \`/pass\` to opt out.`,
    ].join("\n"),
    color: 0x3b82f6,
    ...(posterUrl ? { image: { url: posterUrl } } : {}),
  };
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "@everyone", embeds: [embed] }),
  }).catch(() => {});
}

export async function postBidPlaced(webhookUrl, { movieTitle, bidderDiscordId, bidderUsername, amount, endsAt }) {
  if (!webhookUrl) return;
  const who = bidderDiscordId ? `<@${bidderDiscordId}>` : `**${bidderUsername}**`;
  const closeStr = endsAt ? ` — closes <t:${Math.floor(new Date(endsAt).getTime() / 1000)}:R>` : "";
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `💰 ${who} bid **${amount} pt${amount !== 1 ? "s" : ""}** on **${movieTitle}**${closeStr}`,
    }),
  }).catch(() => {});
}

export async function postAuctionClosingSoon(webhookUrl, { movieTitle, posterUrl, currentBid, currentBidderUsername, currentBidderDiscordId, endsAt }) {
  if (!webhookUrl) return;
  const unixSec = Math.floor(new Date(endsAt).getTime() / 1000);
  const who = currentBidderDiscordId ? `<@${currentBidderDiscordId}>` : `**${currentBidderUsername}**`;
  const embed = {
    title: `⏰ Closing Soon: ${movieTitle}`,
    description: [
      `Current bid: **${currentBid} pt${currentBid !== 1 ? "s" : ""}** by ${who}`,
      ``,
      `**Closes:** <t:${unixSec}:F> (<t:${unixSec}:R>)`,
      ``,
      `Last chance — use \`/bid\` to raise the bid or \`/pass\` to opt out.`,
    ].join("\n"),
    color: 0xf59e0b,
    ...(posterUrl ? { image: { url: posterUrl } } : {}),
  };
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "@everyone", embeds: [embed] }),
  }).catch(() => {});
}

export async function postPassPlaced(webhookUrl, { movieTitle, passerDiscordId, passerUsername }) {
  if (!webhookUrl) return;
  const who = passerDiscordId ? `<@${passerDiscordId}>` : `**${passerUsername}**`;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `⏭️ ${who} passed on **${movieTitle}**`,
    }),
  }).catch(() => {});
}

export async function postAuctionSettled(webhookUrl, { movieTitle, posterUrl, winnerDiscordId, winnerUsername, amount, releaseDate }) {
  if (!webhookUrl) return;
  const who = winnerDiscordId ? `<@${winnerDiscordId}>` : `**${winnerUsername}**`;
  const relStr = releaseDate
    ? new Date(releaseDate + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
      })
    : "TBD";
  const embed = {
    title: `🏆 Auction Closed: ${movieTitle}`,
    description: [
      `${who} won **${movieTitle}** for **${amount} pt${amount !== 1 ? "s" : ""}**!`,
      ``,
      `**Release Date:** ${relStr}`,
    ].join("\n"),
    color: 0x10b981,
    ...(posterUrl ? { image: { url: posterUrl } } : {}),
  };
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "@everyone", embeds: [embed] }),
  }).catch(() => {});
}

async function postOne(webhookUrl, { content, pngBytes, filename }) {
  if (pngBytes) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content }));
    form.append("files[0]", new Blob([pngBytes], { type: "image/png" }), filename);
    const res = await fetch(webhookUrl, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    return;
  }
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => res.statusText)}`);
}
