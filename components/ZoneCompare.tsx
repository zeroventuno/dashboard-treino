// Prescribed vs executed, zone by zone.
//
// The one thing the numbers above it can't say. Duration, distance and TSS agree
// that the session happened; only this shows that the hour was spent in zone 2
// when the coach asked for twenty minutes at threshold. Two bars per zone —
// what was asked, what was done — because a coach scanning a roster reads a
// shape faster than a table.
import { ZONE_KEYS, totalSeconds, biggestMiss, type ZoneKey, type ZoneSeconds } from "@/lib/zone-time";
import { translator, type Locale } from "@/lib/i18n";

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

export function ZoneCompare({
  planned,
  actual,
  locale,
}: {
  planned: ZoneSeconds | null;
  actual: ZoneSeconds | null;
  locale: Locale;
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
        </span>
        <span className="text-[10px] text-[var(--text-faint)]">
          {mins(totalSeconds(planned))} → {mins(totalSeconds(actual))}
        </span>
      </div>

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
      {miss && miss.seconds >= 120 && (
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
