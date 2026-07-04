import type { InjuryEntry } from "@/lib/types";
import { fmtDayMonth } from "@/lib/utils";

const AREA_LABEL: Record<string, string> = {
  left_knee: "Joelho esq.", right_knee: "Joelho dir.",
  left_shoulder: "Ombro esq.", right_shoulder: "Ombro dir.",
  left_hip_sciatic: "Quadril/ciático esq.", right_hip_sciatic: "Quadril/ciático dir.",
  IT_band: "Banda IT", left_calf: "Panturrilha esq.", right_calf: "Panturrilha dir.",
  lower_back: "Lombar",
};

function sevColor(s: number) {
  if (s >= 4) return "var(--bad)";
  if (s >= 3) return "var(--warn)";
  return "var(--good)";
}

export function InjuryTracker({ injuries }: { injuries: InjuryEntry[] }) {
  if (injuries.length === 0) {
    return <p className="text-[13px] text-[var(--text-faint)]">Nenhum ponto de atenção. 💪</p>;
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
