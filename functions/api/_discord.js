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
  const blocks = users.map((u, idx) => formatUserBlock(u, idx + 1));
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

function formatUserBlock(user, place) {
  const header = `# ${user.username} => Total Profit = ${formatShort(user.total_profit)} *(${ordinalPlace(place)} Place)*`;
  const lines = (user.movies || []).map(formatMovieLine);
  return [header, ...lines].join("\n");
}

function formatMovieLine(m) {
  const revenue = formatShort(m.revenue || 0);
  const budget = formatShort(m.budget || 0);
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
  // Released or unreleased and still in play.
  return `* **${m.title}** => ${revenue} - ${budget} = ${profitStr}`;
}

// Chart.js config for the weekly profit chart. Dark-friendly but exported
// over a white background so it reads in Discord's light and dark themes.
export function buildChartConfig(history) {
  const { dates = [], series = [] } = history || {};
  // Shorten labels — many release dates makes the axis unreadable.
  const labels = dates.map((d) => d.slice(5)); // "MM-DD"

  return {
    type: "line",
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.username,
        data: s.points,
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: "transparent",
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.1,
      })),
    },
    options: {
      plugins: {
        title: { display: true, text: "Total Profit", font: { size: 20 } },
        legend: { position: "top" },
      },
      scales: {
        x: { ticks: { maxRotation: 60, minRotation: 60, autoSkip: true, maxTicksLimit: 20 } },
        y: { ticks: { callback: "FORMAT_CURRENCY" } },
      },
    },
  };
}

// POST the chart config to QuickChart, return PNG bytes.
// QuickChart's /chart endpoint returns the PNG directly when the request
// is a POST with JSON body — simpler than the two-step create+fetch flow.
export async function renderChartPng(config) {
  const body = {
    chart: serializeChart(config),
    width: 1000,
    height: 520,
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

// QuickChart accepts JS-style config strings for callbacks — but we send
// JSON, so replace the placeholder with a stringified function the service
// evaluates server-side. QuickChart allows this when `version` is set.
function serializeChart(config) {
  const str = JSON.stringify(config);
  return str.replace(
    '"FORMAT_CURRENCY"',
    "function(value) { if (Math.abs(value) >= 1e9) return '$' + (value/1e9).toFixed(1) + 'B'; if (Math.abs(value) >= 1e6) return '$' + (value/1e6).toFixed(0) + 'M'; if (Math.abs(value) >= 1e3) return '$' + (value/1e3).toFixed(0) + 'K'; return '$' + value; }"
  );
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
