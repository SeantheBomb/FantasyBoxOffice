import { useMemo, useRef, useState } from "react";

const COLORS = ["#60a5fa", "#f87171", "#fbbf24", "#34d399", "#c084fc", "#fb923c", "#22d3ee", "#f472b6"];
const VW = 1000;
const VH = 420;
const PAD = { l: 65, r: 15, t: 20, b: 115 };

export default function ProfitChart({ dates, series, movies = [], revenues = {}, releaseWeeks = {} }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const { x, y, yTicks } = useMemo(
    () => computeLayout(dates, series, releaseWeeks),
    [dates, series, releaseWeeks]
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  if (!dates?.length || !series?.length) {
    return <div style={{ color: "#a49784", padding: 16 }}>No chart data yet — waiting on daily revenue updates.</div>;
  }

  const axisY = VH - PAD.b;

  // Find nearest past data point to mouse X using the weighted x() function.
  function handleMouseMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * VW;
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] > today) break; // past dates come first; stop at first future
      const dist = Math.abs(x(i) - svgX);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    setHoverIdx(best >= 0 ? best : null);
  }

  const tooltip = hoverIdx != null ? buildTooltip(hoverIdx, dates, series, movies, revenues) : null;

  // "Today" marker: last past weekly sample
  let todayIdx = -1;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] <= today) { todayIdx = i; break; }
  }

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
        {/* Y grid + labels */}
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

        {/* X axis */}
        <line x1={PAD.l} x2={VW - PAD.r} y1={axisY} y2={axisY} stroke="#352d3e" />

        {/* Series lines — M on first point or after a null gap, L otherwise */}
        {series.map((s, si) => {
          let d = "";
          for (let i = 0; i < s.points.length; i++) {
            const v = s.points[i];
            if (v == null) continue;
            const prevNull = i === 0 || s.points[i - 1] == null;
            d += `${prevNull ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
          }
          return <path key={s.username} d={d} stroke={COLORS[si % COLORS.length]} strokeWidth={2} fill="none" />;
        })}

        {/* "Today" end-of-data marker */}
        {todayIdx >= 0 && (
          <line x1={x(todayIdx)} x2={x(todayIdx)} y1={PAD.t} y2={axisY}
            stroke="#5d5020" strokeWidth={1} strokeDasharray="4 3" />
        )}

        {/* Release-week vertical markers + rotated multi-line labels */}
        {Object.entries(releaseWeeks).map(([weekDate, entries]) => {
          const i = dates.indexOf(weekDate);
          if (i < 0) return null;
          const lx = x(i);
          const ly = axisY + 5;
          const isPast = entries.some((e) => e.past);
          return (
            <g key={"rel" + weekDate}>
              <line x1={lx} x2={lx} y1={PAD.t} y2={axisY}
                stroke={isPast ? "#4a3f5c" : "#332b40"}
                strokeWidth={1} strokeDasharray="2 3" />
              <text
                x={lx} y={ly}
                textAnchor="end" fontSize={9.5}
                fill={isPast ? "#c4b5a5" : "#6b5e7a"}
                transform={`rotate(-50, ${lx}, ${ly})`}
              >
                {entries.map((e, ti) => (
                  <tspan key={ti} x={lx} dy={ti === 0 ? 0 : 13}>
                    {e.title.length > 22 ? e.title.slice(0, 20) + "…" : e.title}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}

        {/* Hover indicator */}
        {hoverIdx != null && (
          <>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD.t} y2={axisY}
              stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
            {series.map((s, si) => {
              const v = s.points[hoverIdx];
              if (v == null) return null;
              return (
                <circle key={si} cx={x(hoverIdx)} cy={y(v)}
                  r={4} fill={COLORS[si % COLORS.length]} stroke="#1e1822" strokeWidth={1.5} />
              );
            })}
          </>
        )}

        {/* Transparent overlay for mouse tracking */}
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

      {/* Hover tooltip — weekly delta breakdown */}
      {tooltip && (
        <div style={{
          position: "absolute", top: 24, right: 24,
          background: "#2a2335", border: "1px solid #4a3f5c", borderRadius: 6,
          padding: "10px 14px", fontSize: 12, color: "#f2ead8",
          pointerEvents: "none", minWidth: 220, maxWidth: 320, zIndex: 10,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: "#c4b5a5", fontSize: 11 }}>
            Week of {fmtDate(tooltip.date)}
          </div>
          {tooltip.users.map((u) => (
            <div key={u.username} style={{ marginBottom: 8 }}>
              <div style={{ color: u.color, fontWeight: 600, marginBottom: 3 }}>
                {u.username}
                <span style={{ color: "#6b5e7a", fontWeight: 400 }}> · {fmt(u.cumulative)} total</span>
              </div>
              {u.weeklyMovies.length === 0
                ? <div style={{ color: "#6b5e7a", paddingLeft: 8 }}>No change this week</div>
                : u.weeklyMovies.map((m) => (
                  <div key={m.tmdb_id} style={{ color: "#a49784", paddingLeft: 8, lineHeight: 1.7 }}>
                    {m.title}:{" "}
                    <span style={{ color: m.delta >= 0 ? "#34d399" : "#f87171" }}>
                      {m.delta >= 0 ? "+" : ""}{fmt(m.delta)}
                    </span>
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

// Weighted X-axis: weeks containing movie releases get proportionally more
// horizontal space so adjacent labels don't overlap.
function computeLayout(dates, series, releaseWeeks) {
  const n = dates?.length || 0;
  const innerW = VW - PAD.l - PAD.r;
  const innerH = VH - PAD.t - PAD.b;

  // Gap weights: n-1 gaps between n points.
  const gapW = new Array(Math.max(0, n - 1)).fill(1);
  for (let i = 0; i < gapW.length; i++) {
    const a = (releaseWeeks?.[dates[i]] || []).length;
    const b = (releaseWeeks?.[dates[i + 1]] || []).length;
    gapW[i] = 1 + Math.max(a, b) * 0.5;
  }
  const totalGap = gapW.reduce((s, w) => s + w, 0) || 1;
  const cum = [0];
  for (let i = 0; i < gapW.length; i++) cum.push(cum[i] + gapW[i]);
  const x = (i) => PAD.l + (cum[i] / totalGap) * innerW;

  let yMin = 0, yMax = 0;
  for (const s of series || []) {
    for (const v of s.points || []) {
      if (v == null) continue;
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const padY = (yMax - yMin) * 0.08;
  yMin -= padY; yMax += padY;
  const y = (v) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (yMax - yMin) * i / 4);
  if (yMin < 0 && yMax > 0 && !yTicks.some((t) => Math.abs(t) < (yMax - yMin) * 0.05)) {
    yTicks.push(0);
  }

  return { x, y, yTicks };
}

// Weekly delta tooltip: shows change this week per movie, plus running cumulative.
function buildTooltip(idx, dates, series, movies, revenues) {
  const date = dates[idx];
  const users = series.map((s, si) => {
    const released = movies.filter(
      (m) => m.owner_user_id === s.userId && m.release_date && m.release_date <= date
    );
    const weeklyMovies = released.map((m) => {
      const revNow = revenues[m.tmdb_id]?.[idx] ?? null;
      if (revNow == null) return null;
      const revPrev = idx > 0 ? (revenues[m.tmdb_id]?.[idx - 1] ?? null) : null;
      // First week of data for this movie: delta includes budget hit.
      // Subsequent weeks: delta is pure revenue change.
      const delta = revPrev != null ? revNow - revPrev : revNow - m.budget;
      return Math.abs(delta) >= 1000 ? { tmdb_id: m.tmdb_id, title: m.title, delta } : null;
    }).filter(Boolean).sort((a, b) => b.delta - a.delta);

    return {
      username: s.username,
      color: COLORS[si % COLORS.length],
      cumulative: s.points[idx] ?? 0,
      weeklyMovies,
    };
  }).sort((a, b) => b.cumulative - a.cumulative);
  return { date, users };
}

function fmtDate(iso) {
  if (!iso) return "";
  const [, yr, mo, d] = iso.match(/^(\d{4})-(\d{2})-(\d{2})/) || [];
  if (!yr) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[+mo - 1]} ${+d}, ${yr}`;
}

function fmt(n) {
  const abs = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${s}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${s}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${s}$${(abs / 1e3).toFixed(0)}K`;
  return `${s}$${Math.round(abs)}`;
}
