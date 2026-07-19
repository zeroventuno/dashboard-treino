import type { DashboardData } from "@/lib/types";
import { fmtSleepHours } from "@/lib/utils";
import { Countdown } from "../Countdown";
import { DEFAULT_LOCALE, translator, type Locale, type TKey } from "@/lib/i18n";

const READY_META: Record<string, { label: TKey; color: string; hint: TKey }> = {
  green: { label: "hero.ready", color: "var(--good)", hint: "hero.readyHint" },
  yellow: { label: "hero.caution", color: "var(--warn)", hint: "hero.cautionHint" },
  red: { label: "hero.recover", color: "var(--bad)", hint: "hero.recoverHint" },
};

function Dot({ active, color }: { active: boolean; color: string }) {
  return (
    <span
      className={`h-3.5 w-3.5 rounded-full transition-all ${active ? "breathe" : ""}`}
      style={{
        background: active ? color : "var(--surface-3)",
        color: active ? color : undefined, // breathe glow uses currentColor
        opacity: active ? 1 : 0.4,
      }}
    />
  );
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{label}</p>
      <p className="tnum text-[15px] font-semibold leading-tight text-[var(--text)]">{value ?? "—"}</p>
    </div>
  );
}

export function HeroBlock({ data, locale = DEFAULT_LOCALE }: { data: DashboardData; locale?: Locale }) {
  const tr = translator(locale);
  const latest = data.checkins.length ? data.checkins[data.checkins.length - 1] : null;
  const rec = latest?.recommendation ?? null;
  const meta = rec ? READY_META[rec] : null;

  return (
    <div
      className="rise tcard grid grid-cols-1 gap-5 rounded-[var(--radius)] border border-[var(--border-soft)] p-6 shadow-[var(--shadow)] sm:grid-cols-[1fr_auto] sm:items-center sm:p-8"
      style={{
        background:
          "radial-gradient(560px 220px at 88% -10%, color-mix(in oklab, var(--lime) 6%, transparent), transparent 70%), linear-gradient(180deg, var(--surface-2), var(--surface))",
      }}
    >
      <div>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--lime)]">
          <span className="breathe inline-block h-1.5 w-1.5 rounded-full bg-[var(--lime)] text-[var(--lime)]" />
          IRONMAN 70.3 Costa Navarino · Greece
        </p>
        <Countdown />
      </div>

      <div className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-soft)]/70 p-4 sm:min-w-[264px]">
        <div className="flex flex-col items-center gap-2">
          <Dot active={rec === "green"} color="var(--good)" />
          <Dot active={rec === "yellow"} color="var(--warn)" />
          <Dot active={rec === "red"} color="var(--bad)" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">{tr("hero.readiness")}</p>
          <p className="dsp mt-0.5 text-[26px] font-extrabold leading-none" style={{ color: meta?.color ?? "var(--text-muted)" }}>
            {meta ? tr(meta.label) : tr("hero.noData")}
          </p>
          {latest && (
            <div className="mt-2.5 grid grid-cols-4 gap-x-3 gap-y-1">
              <Stat label={tr("hero.score")} value={latest.readiness_score} />
              <Stat label={tr("hero.hrv")} value={latest.hrv} />
              <Stat label={tr("hero.battery")} value={latest.body_battery} />
              <Stat label={tr("hero.sleep")} value={fmtSleepHours(latest.sleep_hours)} />
            </div>
          )}
          <p className="mt-2 text-[12px] text-[var(--text-faint)]">
            {meta ? tr(meta.hint) : tr("hero.noDataHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
