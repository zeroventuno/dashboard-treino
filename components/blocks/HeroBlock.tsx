import type { DashboardData } from "@/lib/types";
import { Countdown } from "../Countdown";

const READY_META: Record<string, { label: string; color: string; hint: string }> = {
  green: { label: "READY", color: "var(--good)", hint: "Follow the plan — green light for the long ride." },
  yellow: { label: "CAUTION", color: "var(--warn)", hint: "Ease the intensity today." },
  red: { label: "RECOVER", color: "var(--bad)", hint: "Prioritise recovery." },
};

function Dot({ active, color }: { active: boolean; color: string }) {
  return (
    <span
      className="h-3.5 w-3.5 rounded-full transition-all"
      style={{ background: active ? color : "var(--surface-3)", boxShadow: active ? `0 0 12px ${color}` : "none", opacity: active ? 1 : 0.4 }}
    />
  );
}

export function HeroBlock({ data }: { data: DashboardData }) {
  const latest = data.checkins.length ? data.checkins[data.checkins.length - 1] : null;
  const rec = latest?.recommendation ?? null;
  const meta = rec ? READY_META[rec] : null;

  return (
    <div className="rise grid grid-cols-1 gap-5 rounded-[var(--radius)] border border-[var(--border-soft)] bg-gradient-to-b from-[var(--surface-2)] to-[var(--surface)] p-6 shadow-[var(--shadow)] sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
      <div>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--lime)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--lime)]" />
          IRONMAN 70.3 Costa Navarino · Greece
        </p>
        <Countdown />
      </div>

      <div className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-soft)]/70 p-4 sm:min-w-[230px]">
        <div className="flex flex-col items-center gap-2">
          <Dot active={rec === "green"} color="var(--good)" />
          <Dot active={rec === "yellow"} color="var(--warn)" />
          <Dot active={rec === "red"} color="var(--bad)" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">Readiness today</p>
          <p className="dsp mt-0.5 text-[26px] font-extrabold leading-none" style={{ color: meta?.color ?? "var(--text-muted)" }}>
            {meta?.label ?? "NO DATA"}
          </p>
          {latest && (
            <p className="tnum mt-0.5 text-[13px] text-[var(--text-muted)]">
              Score {latest.readiness_score ?? "—"} · HRV {latest.hrv ?? "—"}
              {latest.body_battery != null ? ` · BB ${latest.body_battery}` : ""} · {latest.sleep_hours ?? "—"}h sleep
            </p>
          )}
          <p className="mt-1 text-[12px] text-[var(--text-faint)]">
            {meta?.hint ?? "Log a check-in in chat to activate."}
          </p>
        </div>
      </div>
    </div>
  );
}
