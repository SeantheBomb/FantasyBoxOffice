import { useMemo, useRef, useState } from "react";

const COLORS = ["#60a5fa", "#f87171", "#fbbf24", "#34d399", "#c084fc", "#fb923c", "#22d3ee", "#f472b6"];

const VW = 1000;
const VH = 420;
const PAD = { l: 65, r: 15, t: 20, b: 110 };

export default function ProfitChart({ dates, series, movies = [], revenues = {} }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);
  const layout = useMemo(() => computeLayout(dates, series), [dates, series]);

  const moviesByDate = useMemo(() => {
    const map = {};
    for (const m of movies) {
      if (m.release_date) (map[m.release_date] = map[m.release_date] || []).push(m.title);
    }
    return map;
  }, [movies]);

  const releaseIdxs = useMemo(
    () => (dates || []).map((d, i) => (moviesByDate[d] ? i : null)).filter((i) => i != null),
    [dates, moviesByDate]
  );

  if (!dates?.length || !series?.length) {
    return <div style={{ color: "#a49784", padding: 16 }}>No chart data yet — waiting on daily revenue updates.</div>;
  }

  const { x, y, yTicks } = layout;
  const axisY = VH - PAD.b;

  function handleMouseMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * VW;
    const n = dates.length;
    const idx = Math.round(((svgX - PAD.l) / (VW - PAD.l - PAD.r)) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  }

  const tooltip = hoverIdx != null ? buildTooltip(hoverIdx, dates, series, movies, revenues) : null;

  return (
    <div style={{ position: "relative", background: "#1e1822", border: "1px solid #352d3e", borderRadius: 8, padding: 16 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        style={{ display: "block", cursor: "crosshair" }}
        aria-label="Total profit over time"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Y grid lines + labels */}
        {yTicks.map((t) => (
          <g key={"y" + t}>
            <line x1={PAD.l} x2={VW - PAD.r} y1={y(t)} y2={y(t)}
              stroke={t === 0 ? "#5d4d35" : "#2d2638"}
              strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#a49784">
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* X axis line */}
        <line x1={PAD.l} x2={VW - PAD.r} y1={axisY} y2={axisY} stroke="#352d3e" />

        {/* Series lines */}
        {series.map((s, si) => {
          const pts = s.points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
          return <path key={s.username} d={pts} stroke={COLORS[si % COLORS.length]} strokeWidth={2} fill="none" />;
        })}

        {/* Release-date vertical marks + rotated movie title labels */}
        {releaseIdxs.map((i) => {
          const label = (moviesByDate[dates[i]] || [])
            .map((t) => (t.length > 22 ? t.slice(0, 20) + "…" : t))
            .join(" / ");
          const lx = x(i);
          const ly = axisY + 5;
          return (
            <g key={"rel" + i}>
              <line x1={lx} x2={lx} y1={PAD.t} y2={axisY} stroke="#4a3f5c" strokeWidth={1} strokeDasharray="2 3" />
              <text
                x={lx} y={ly}
                textAnchor="end" fontSize={9.5} fill="#c4b5a5"
                transform={`rotate(-50, ${lx}, ${ly})`}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Hover line + dots */}
        {hoverIdx != null && (
          <>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD.t} y2={axisY}
              stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
            {series.map((s, si) => (
              <circle key={si}
                cx={x(hoverIdx)} cy={y(s.points[hoverIdx])}
                r={4} fill={COLORS[si % COLORS.length]} stroke="#1e1822" strokeWidth={1.5}
              />
            ))}
          </>
        )}

        {/* Transparent overlay captures mouse events over chart area */}
        <rect x={PAD.l} y={PAD.t} width={VW - PAD.l - PAD.r} height={axisY - PAD.t} fill="transparent" />
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
        {series.map((s, si) => (
          <div key={s.username} style={{ fontSize: 13, color: "#f2ead8", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 14, height: 3, background: COLORS[si % COLORS.length], borderRadius: 1 }} />
            {s.username}
          </div>
        ))}
      </div>

      {/* Hover tooltip — pinned top-right so it never clips off-screen */}
      {tooltip && (
        <div style={{
          position: "absolute", top: 24, right: 24,
          background: "#2a2335", border: "1px solid #4a3f5c", borderRadius: 6,
          padding: "10px 14px", fontSize: 12, color: "#f2ead8",
          pointerEvents: "none", minWidth: 220, maxWidth: 320, zIndex: 10,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: "#c4b5a5", fontSize: 11 }}>
            {fmtDate(tooltip.date)}
          </div>
          {tooltip.users.map((u) => (
            <div key={u.username} style={{ marginBottom: 8 }}>
              <div style={{ color: u.color, fontWeight: 600, marginBottom: 3 }}>
                {u.username}: {fmt(u.total)}
              </div>
              {u.movies.length === 0
                ? <div style={{ color: "#6b5e7a", paddingLeft: 8 }}>No released movies yet</div>
                : u.movies.map((m) => (
                  <div key={m.tmdb_id} style={{ color: "#a49784", paddingLeft: 8, lineHeight: 1.7 }}>
                    {m.title}:{" "}
                    <span style={{ color: m.profit >= 0 ? "#34d399" : "#f87171" }}>{fmt(m.profit)}</span>
                  </div>
                ))
              }
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function computeLayout(dates, series) {
  const n = dates?.length || 0;
  const innerW = VW - PAD.l - PAD.r;
  const innerH = VH - PAD.t - PAD.b;

  let yMin = 0, yMax = 0;
  for (const s of series || []) {
    for (const v of s.points || []) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const padY = (yMax - yMin) * 0.08;
  yMin -= padY; yMax += padY;

  const x = (i) => PAD.l + (i / Math.max(1, n - 1)) * innerW;
  const y = (v) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (yMax - yMin) * i / 4);
  if (yMin < 0 && yMax > 0 && !yTicks.some((t) => Math.abs(t) < (yMax - yMin) * 0.05)) {
    yTicks.push(0);
  }

  return { x, y, yTicks };
}

function buildTooltip(idx, dates, series, movies, revenues) {
  const date = dates[idx];
  const users = series.map((s, si) => {
    const released = movies.filter(
      (m) => m.owner_user_id === s.userId && m.release_date && m.release_date <= date
    );
    const breakdown = released.map((m) => {
      const rev = revenues[m.tmdb_id]?.[idx] ?? 0;
      return { tmdb_id: m.tmdb_id, title: m.title, profit: rev - m.budget };
    }).sort((a, b) => b.profit - a.profit);
    return { username: s.username, color: COLORS[si % COLORS.length], total: s.points[idx], movies: breakdown };
  }).sort((a, b) => b.total - a.total);
  return { date, users };
}

function fmtDate(iso) {
  if (!iso) return "";
  const [, y, mo, d] = iso.match(/^(\d{4})-(\d{2})-(\d{2})/) || [];
  if (!y) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[+mo - 1]} ${+d}, ${y}`;
}

function fmt(n) {
  const abs = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${s}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${s}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${s}$${(abs / 1e3).toFixed(0)}K`;
  return `${s}$${Math.round(abs)}`;
}
