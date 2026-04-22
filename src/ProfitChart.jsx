import { useMemo } from "react";

const COLORS = ["#3b82f6", "#ef4444", "#eab308", "#10b981", "#a855f7", "#f97316", "#14b8a6", "#ec4899"];

// Minimal SVG line chart. Takes { dates: [], series: [{username, points: []}] }.
export default function ProfitChart({ dates, series, height = 320 }) {
  const layout = useMemo(() => computeLayout(dates, series, height), [dates, series, height]);
  if (!dates?.length || !series?.length) {
    return <div style={{ color: "#888", padding: 16 }}>No chart data yet — waiting on daily revenue updates.</div>;
  }

  const { width, yMin, yMax, x, y, xTicks, yTicks } = layout;
  return (
    <div style={{ overflowX: "auto", background: "white", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <svg width={width} height={height} role="img" aria-label="Total profit over time">
        {yTicks.map((t) => (
          <g key={"y" + t}>
            <line x1={48} x2={width - 12} y1={y(t)} y2={y(t)} stroke="#eee" />
            <text x={40} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#666">
              {formatShort(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={"x" + i} x={x(i)} y={height - 4} textAnchor="middle" fontSize={10} fill="#666">
            {dates[i]?.slice(5)}
          </text>
        ))}
        {series.map((s, si) => {
          const color = COLORS[si % COLORS.length];
          const d = s.points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
          return <path key={s.username} d={d} stroke={color} strokeWidth={2} fill="none" />;
        })}
        <line x1={48} x2={width - 12} y1={y(0)} y2={y(0)} stroke="#999" strokeDasharray="4 4" />
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
        {series.map((s, si) => (
          <div key={s.username} style={{ fontSize: 13, color: "#222", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, background: COLORS[si % COLORS.length], borderRadius: 2 }} />
            {s.username}
          </div>
        ))}
      </div>
      <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
        Y range: {formatShort(yMin)} to {formatShort(yMax)}
      </div>
    </div>
  );
}

function computeLayout(dates, series, height) {
  const width = Math.max(600, (dates?.length || 0) * 30 + 80);
  const padL = 48, padR = 12, padT = 12, padB = 24;
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

  const x = (i) => padL + (i / Math.max(1, (dates?.length || 1) - 1)) * innerW;
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const yTicks = [yMin, yMin + (yMax - yMin) * 0.25, yMin + (yMax - yMin) * 0.5, yMin + (yMax - yMin) * 0.75, yMax];
  const xTickCount = Math.min(dates?.length || 0, 8);
  const xStep = Math.max(1, Math.floor((dates?.length || 1) / xTickCount));
  const xTicks = [];
  for (let i = 0; i < (dates?.length || 0); i += xStep) xTicks.push(i);

  return { width, yMin, yMax, x, y, xTicks, yTicks };
}

function formatShort(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(abs)}`;
}
