import type { Checkin } from "@/lib/types";
import { READINESS_META } from "@/lib/utils";
import { Countdown } from "./Countdown";
import { RACE_NAME } from "@/lib/types";

function ReadinessDot({ active, color }: { active: boolean; color: string }) {
  return (
    <span
      className="h-3.5 w-3.5 rounded-full transition-all"
      style={{
        background: active ? color : "var(--surface-2)",
        boxShadow: active ? `0 0 12px ${color}` : "none",
        opacity: active ? 1 : 0.35,
      }}
    />
  );
}

export function HeaderHero({ latest }: { latest: Checkin | null }) {
  const rec = latest?.recommendation ?? null;
  const meta = rec ? READINESS_META[rec] : null;

  return (
    <div className="rise grid grid-cols-1 gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-gradient-to-b from-[var(--surface-2)] to-[var(--surface)] p-6 shadow-[var(--shadow)] sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
      <div>
        <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--surge)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--surge)]" />
          {RACE_NAME}
        </p>
        <Countdown />
      </div>

      <div className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-soft)]/60 p-4 sm:min-w-[220px]">
        <div className="flex flex-col items-center gap-2">
          <ReadinessDot active={rec === "green"} color="var(--good)" />
          <ReadinessDot active={rec === "yellow"} color="var(--warn)" />
          <ReadinessDot active={rec === "red"} color="var(--bad)" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
            Readiness hoje
          </p>
          <p className="mt-0.5 text-2xl font-bold" style={{ color: meta?.color ?? "var(--text-muted)" }}>
            {meta?.label ?? "Sem dados"}
          </p>
          {latest && (
            <p className="tnum mt-0.5 text-[13px] text-[var(--text-muted)]">
              {latest.readiness_score ?? "—"} · HRV {latest.hrv ?? "—"} · {latest.sleep_hours ?? "—"}h sono
            </p>
          )}
          {meta && <p className="mt-1 text-[12px] text-[var(--text-faint)]">{meta.hint}</p>}
        </div>
      </div>
    </div>
  );
}
