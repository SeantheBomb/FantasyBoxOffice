import { useMemo } from "react";

const COLORS = ["#60a5fa", "#f87171", "#fbbf24", "#34d399", "#c084fc", "#fb923c", "#22d3ee", "#f472b6"];

// Minimal SVG line chart tuned for a full-season X axis.
export default function ProfitChart({ dates, series, height = 360 }) {
  const layout = useMemo(() => computeLayout(dates, series, height), [dates, series, height]);
  if (!dates?.length || !series?.length) {
    return <div style={{ color: "#a49784", padding: 16 }}>No chart data yet — waiting on daily revenue updates.</div>;
  }

  const { width, x, y, xTicks, yTicks } = layout;
  return (
    <div style={{ overflowX: "auto", background: "#1e1822", border: "1px solid #352d3e", borderRadius: 8, padding: 16 }}>
      <svg width={width} height={height} role="img" aria-label="Total profit over time">
        {yTicks.map((t) => (
          <g key={"y" + t}>
            <line x1={60} x2={width - 12} y1={y(t)} y2={y(t)} stroke="#2d2638" strokeDasharray={t === 0 ? "none" : "2 4"} />
            <text x={52} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#a49784">
              {formatShort(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={"x" + i} x={x(i)} y={height - 4} textAnchor="middle" fontSize={10} fill="#a49784">
            {formatDateLabel(dates[i])}
          </text>
        ))}
        {series.map((s, si) => {
          const color = COLORS[si % COLORS.length];
          const d = s.points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
          return <path key={s.username} d={d} stroke={color} strokeWidth={2.5} fill="none" style={{ filter: "drop-shadow(0 0 3px rgba(0,0,0,0.6))" }} />;
        })}
        <line x1={60} x2={width - 12} y1={y(0)} y2={y(0)} stroke="#5d4d35" />
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
        {series.map((s, si) => (
          <div key={s.username} style={{ fontSize: 13, color: "#f2ead8", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 3, background: COLORS[si % COLORS.length], borderRadius: 1 }} />
            {s.username}
          </div>
        ))}
      </div>
    </div>
  );
}

function computeLayout(dates, series, height) {
  // For a full-year chart we want consistent pixel density per time unit,
  // not per sample. Pack ~3-4 px per day across ~365 days.
  const n = dates?.length || 0;
  const width = Math.max(700, Math.min(1600, n * 18 + 80));
  const padL = 60, padR = 12, padT = 16, padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  let yMin = 0, yMax = 0;
  for (const s of series || []) {
    for (const v of s.points || []) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * 0.1;
  yMin -= pad; yMax += pad;

  const x = (i) => padL + (i / Math.max(1, n - 1)) * innerW;
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const yTicks = [yMin, yMin + (yMax - yMin) * 0.25, yMin + (yMax - yMin) * 0.5, yMin + (yMax - yMin) * 0.75, yMax];
  if (yMin < 0 && yMax > 0 && !yTicks.includes(0)) yTicks.push(0);

  // Prefer ~10 X ticks to avoid overcrowding.
  const xTickCount = Math.min(n, 12);
  const step = Math.max(1, Math.floor(n / xTickCount));
  const xTicks = [];
  for (let i = 0; i < n; i += step) xTicks.push(i);
  if (xTicks[xTicks.length - 1] !== n - 1) xTicks.push(n - 1);

  return { width, yMin, yMax, x, y, xTicks, yTicks };
}

function formatDateLabel(iso) {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function formatShort(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(abs)}`;
}
