import { adherenceColor } from "@/lib/utils";

/** A compact adherence donut: an arc filled to `score`% in a traffic-light
 * colour, the number in the middle. Used per-workout in the modal and, at a
 * smaller size, for the weekly average. Pure SVG — no client JS. */
export function AdherenceDonut({
  score,
  size = 44,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const stroke = Math.max(3, Math.round(size * 0.1));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const color = adherenceColor(pct);

  return (
    <div className="inline-flex flex-col items-center gap-1" title={label ? `${label}: ${pct}%` : `${pct}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={`${pct}%`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className="rotate-90 font-bold"
          style={{ fontSize: size * 0.32, fill: color, transformOrigin: "center" }}
        >
          {pct}
        </text>
      </svg>
      {label && <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{label}</span>}
    </div>
  );
}
