import type { Discipline, WorkoutBlock } from "@/lib/types";
import { DISCIPLINE_META } from "@/lib/utils";
import { fmtBlockDuration } from "@/lib/workout-structure";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";

/**
 * Workout profile: bar width = duration, bar height = intensity (% of
 * threshold). One series, so no legend — and since height already encodes
 * intensity, the colour ramp is redundant reinforcement rather than the only
 * cue. Uses the discipline's own hue (single hue, light→dark = sequential).
 */
export function WorkoutBlocks({ blocks, discipline, locale = DEFAULT_LOCALE }: { blocks: WorkoutBlock[]; discipline: Discipline; locale?: Locale }) {
  if (blocks.length === 0) return null;
  const tr = translator(locale);

  const hue = DISCIPLINE_META[discipline].color;
  const totalMin = blocks.reduce((s, b) => s + b.duration_min, 0);
  const hasIntensity = blocks.some((b) => b.intensity != null);
  // Headroom above threshold so a 110% VO2 block isn't clipped.
  const ceiling = Math.max(120, ...blocks.map((b) => b.intensity ?? 0));

  return (
    <div>
      {/* profile */}
      <div
        className="relative h-[104px]"
        role="img"
        aria-label={`${tr("profile.aria")}: ${blocks.length} ${tr("profile.blocks")}, ${fmtBlockDuration(totalMin)}`}
      >
        {/* threshold reference, positioned as a share of the plot height */}
        {hasIntensity && ceiling > 100 && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--text-faint)]/45"
            style={{ bottom: `${(100 / ceiling) * 100}%` }}
            aria-hidden
          >
            <span className="absolute right-0 -top-[13px] text-[9px] font-semibold tracking-wide text-[var(--text-faint)]">
              {tr("profile.threshold")}
            </span>
          </div>
        )}

        <div className="flex h-full items-end gap-[2px]">
          {blocks.map((b, i) => {
            const pct = b.intensity ?? 60;
            const height = hasIntensity ? Math.max(8, (pct / ceiling) * 100) : 55;
            // faint at easy, saturated at threshold+
            const strength = Math.min(1, Math.max(0.28, (pct - 30) / 80));
            return (
              <div
                key={i}
                className="min-w-[3px] rounded-t-[4px]"
                style={{
                  flexGrow: Math.max(b.duration_min, 0.25),
                  flexBasis: 0,
                  height: `${height}%`,
                  background: `color-mix(in oklab, ${hue} ${Math.round(strength * 100)}%, transparent)`,
                }}
                title={`${b.label} · ${fmtBlockDuration(b.duration_min)}${b.target ? ` · ${b.target}` : ""}`}
              />
            );
          })}
        </div>
      </div>

      {/* block list */}
      <ul className="mt-3 divide-y divide-[var(--border-soft)] border-t border-[var(--border-soft)]">
        {blocks.map((b, i) => (
          <li key={i} className="flex items-baseline gap-3 py-[7px] text-[12.5px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hue }} />
            <span className="flex-1 truncate text-[var(--text-2)]">
              {b.label}
              {b.note && <span className="text-[var(--text-faint)]"> · {b.note}</span>}
            </span>
            {b.target && <span className="tnum shrink-0 text-[var(--text-muted)]">{b.target}</span>}
            <span className="tnum w-[52px] shrink-0 text-right font-semibold text-[var(--text)]">
              {fmtBlockDuration(b.duration_min)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 text-right text-[11px] text-[var(--text-faint)]">
        {blocks.length} {tr("profile.blocks")} · {fmtBlockDuration(totalMin)} {tr("profile.total")}
      </p>
    </div>
  );
}
