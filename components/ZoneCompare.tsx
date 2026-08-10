// Prescribed vs executed, zone by zone.
//
// The one thing the numbers above it can't say. Duration, distance and TSS agree
// that the session happened; only this shows that the hour was spent in zone 2
// when the coach asked for twenty minutes at threshold. Two bars per zone —
// what was asked, what was done — because a coach scanning a roster reads a
// shape faster than a table.
import { ZONE_KEYS, totalSeconds, biggestMiss, type ZoneKey, type ZoneSeconds } from "@/lib/zone-time";
import { translator, type Locale, type TKey } from "@/lib/i18n";

/** Same ramp the season timeline and the block chart use, so "the red one" means
 * the same intensity everywhere in the product. */
const ZONE_COLOR: Record<ZoneKey, string> = {
  z1: "var(--text-faint)",
  z2: "var(--good)",
  z3: "var(--lime)",
  z4: "var(--warn)",
  z5: "var(--bad)",
};

/** Zone time reads in whole minutes — nobody prescribes 1.7 minutes of Z4. */
function mins(seconds: number): string {
  return `${Math.round(seconds / 60)}min`;
}

/** Human name for the unit the execution was measured in. */
const METRIC_LABEL: Record<string, TKey> = {
  power: "metric.power",
  pace: "metric.pace",
  heart_rate: "metric.heartRate",
  rpe: "metric.rpe",
};

export function ZoneCompare({
  planned,
  actual,
  locale,
  metric = null,
  comparable = true,
}: {
  planned: ZoneSeconds | null;
  actual: ZoneSeconds | null;
  locale: Locale;
  /** What the device was read in — shown so the reader knows what they're
   * looking at, rather than having to assume. */
  metric?: string | null;
  /** False when the prescription and the execution are in different units. */
  comparable?: boolean;
}) {
  const tr = translator(locale);
  if (!planned || !actual) return null;

  // One scale for both bars, or the comparison lies: a 12-minute prescription
  // drawn as wide as a 45-minute execution would read as a match.
  const peak = Math.max(
    ...ZONE_KEYS.map((z) => Math.max(planned[z], actual[z])),
    1,
  );

  const shown = ZONE_KEYS.filter((z) => planned[z] > 0 || actual[z] > 0);
  if (!shown.length) return null;

  const miss = biggestMiss(planned, actual);

  return (
    <div className="border-b border-[var(--border)] px-5 py-3.5">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
          {tr("zones.compare")}
          {metric && METRIC_LABEL[metric] && (
            <span className="ml-1.5 font-medium normal-case text-[var(--text-faint)]">
              · {tr(METRIC_LABEL[metric])}
            </span>
          )}
        </span>
        <span className="text-[10px] text-[var(--text-faint)]">
          {mins(totalSeconds(planned))} → {mins(totalSeconds(actual))}
        </span>
      </div>

      {/* The honest answer when the two sides aren't the same unit. Drawing the
          bars anyway would invite a comparison the numbers can't support — which
          is how a brick run prescribed in pace and measured by heart rate came
          out at 4 out of 100. */}
      {!comparable && (
        <p className="mb-3 rounded-[8px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
          {tr("zones.mismatch")}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {shown.map((z) => (
          <div key={z} className="grid grid-cols-[26px_1fr_auto] items-center gap-2.5">
            <span className="text-[11px] font-bold uppercase" style={{ color: ZONE_COLOR[z] }}>
              {z.toUpperCase()}
            </span>
            <span className="flex flex-col gap-[3px]">
              {/* Prescribed: outline. Executed: solid. The coach's intent is the
                  frame, what happened is the fill. */}
              <span
                className="h-[6px] rounded-full border"
                style={{
                  width: `${(planned[z] / peak) * 100}%`,
                  borderColor: ZONE_COLOR[z],
                  minWidth: planned[z] > 0 ? 3 : 0,
                }}
              />
              <span
                className="h-[6px] rounded-full"
                style={{
                  width: `${(actual[z] / peak) * 100}%`,
                  background: ZONE_COLOR[z],
                  minWidth: actual[z] > 0 ? 3 : 0,
                }}
              />
            </span>
            <span className="tnum text-[11px] text-[var(--text-faint)]">
              {mins(planned[z])} <span className="text-[var(--text)]">/ {mins(actual[z])}</span>
            </span>
          </div>
        ))}
      </div>

      {/* The sentence a coach with a hundred athletes actually needs. */}
      {comparable && miss && miss.seconds >= 120 && (
        <p className="mt-2.5 text-[11.5px] text-[var(--text-muted)]">
          <span className="font-bold" style={{ color: ZONE_COLOR[miss.zone] }}>
            −{mins(miss.seconds)} {miss.zone.toUpperCase()}
          </span>{" "}
          {tr("zones.missed")}
        </p>
      )}
    </div>
  );
}
