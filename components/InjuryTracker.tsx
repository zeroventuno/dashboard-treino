import type { InjuryEntry } from "@/lib/types";
import { fmtDayMonth } from "@/lib/utils";

const AREA_LABEL: Record<string, string> = {
  left_knee: "Left knee", right_knee: "Right knee",
  left_shoulder: "Left shoulder", right_shoulder: "Right shoulder",
  left_hip_sciatic: "Left hip / sciatic", right_hip_sciatic: "Right hip / sciatic",
  IT_band: "IT band", left_calf: "Left calf", right_calf: "Right calf",
  lower_back: "Lower back",
};

/** Severity 1-5 → amber, orange, red. Exported because the coach roster must
 * colour an injury exactly as the athlete sees it: the same number meaning two
 * different colours in two screens is worse than no colour at all.
 *
 * There is no green here on purpose. A mild niggle is still a niggle, and the
 * scale used to bottom out at --good, which painted a reassuring green tick on
 * something that by definition needs watching. The orange is mixed from the two
 * existing tokens rather than added as a third: it is then guaranteed to sit
 * between them, and it moves with the palette if those ever change. */
export function sevColor(s: number) {
  if (s >= 4) return "var(--bad)";
  if (s >= 3) return "color-mix(in oklab, var(--warn) 45%, var(--bad))";
  return "var(--warn)";
}

export function InjuryTracker({ injuries }: { injuries: InjuryEntry[] }) {
  if (injuries.length === 0) {
    return <p className="text-[13px] text-[var(--text-faint)]">No watch points. All clear. 💪</p>;
  }
  return (
    <ul className="space-y-2.5">
      {injuries.slice(0, 5).map((inj) => {
        const sev = inj.severity ?? 1;
        return (
          <li key={inj.id} className="flex gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="flex flex-col items-center gap-1 pt-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: i < sev ? sevColor(sev) : "var(--border)" }}
                />
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-[var(--text)]">
                  {AREA_LABEL[inj.area] ?? inj.area}
                </span>
                <span className="tnum shrink-0 text-[11px] text-[var(--text-faint)]">{fmtDayMonth(inj.date)}</span>
              </div>
              {inj.notes && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-[var(--text-muted)]">{inj.notes}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
