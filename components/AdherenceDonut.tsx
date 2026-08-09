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
      {/* The arc is rotated with SVG's own transform attribute rather than a CSS
          class on the <svg>. The CSS route meant counter-rotating the number to
          keep it upright, and `transform-origin: center` on an SVG <text> is
          resolved differently by WebKit — on iOS the number span away from the
          middle and off the canvas, so the donut drew but the score vanished.
          Rotating only the arc means the text never needs a transform at all. */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct}%`}>
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
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {/* dy="0.35em" instead of dominant-baseline: the property has been
            unreliable on iOS Safari, and this centres text in every engine. */}
        <text
          x={size / 2}
          y={size / 2}
          dy="0.35em"
          textAnchor="middle"
          className="font-bold"
          style={{ fontSize: size * 0.32, fill: color }}
        >
          {pct}
        </text>
      </svg>
      {label && <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{label}</span>}
    </div>
  );
}
