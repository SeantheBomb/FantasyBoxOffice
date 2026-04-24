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
  // Skip unreleased movies — they have no revenue yet and just clutter the recap.
  const visible = (user.movies || []).filter((m) => m.status !== "unreleased");
  const lines = visible.map(formatMovieLine);
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

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Chart.js config for the weekly profit chart. Dark-friendly but exported
// over a white background so it reads in Discord's light and dark themes.
//
// Two-layer X-axis: the primary `x` scale shows movie titles at release weeks;
// a secondary `months` scale (also at position "bottom", so it renders below)
// shows month abbreviations at the first Sunday of each month.
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

  return {
    type: "line",
    data: {
      labels: movieLabels,
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
        // Primary x-axis: movie titles, rotated so they don't overlap.
        x: {
          ticks: { maxRotation: 65, minRotation: 65, autoSkip: false },
        },
        // Secondary x-axis: month labels, flat, drawn below the movie titles.
        months: {
          type: "category",
          labels: monthLabels,
          position: "bottom",
          display: true,
          grid: { display: false, drawTicks: false },
          ticks: { maxRotation: 0, minRotation: 0, autoSkip: false, font: { weight: "bold" } },
        },
        // Y-axis: dollar-formatted values.
        // QuickChart evals strings starting with "function" or "(" server-side.
        y: {
          display: true,
          ticks: {
            display: true,
            callback: "(v) => { var a=Math.abs(v), p=v<0?'-$':'$'; if(a>=1e9) return p+(a/1e9).toFixed(1)+'B'; if(a>=1e6) return p+(a/1e6).toFixed(0)+'M'; if(a>=1e3) return p+(a/1e3).toFixed(0)+'K'; return p+a; }",
          },
        },
      },
    },
  };
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
