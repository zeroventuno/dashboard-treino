// Config-aware hero for the /demo route. Renders a race countdown (with an
// A/B/C race list) or a training-cycle progress ("week X of Y" + phase),
// and shows only the readiness stats the athlete's device actually provides.
import type { DashboardData } from "@/lib/types";
import type { Metric, TenantConfig } from "@/lib/tenant-config";
import { addDays, daysBetween, fmtSleepHours, parseDate, toISO } from "@/lib/utils";

const READY_META: Record<string, { label: string; color: string; hint: string }> = {
  green: { label: "READY", color: "var(--good)", hint: "Follow the plan — green light." },
  yellow: { label: "CAUTION", color: "var(--warn)", hint: "Ease the intensity today." },
  red: { label: "RECOVER", color: "var(--bad)", hint: "Prioritise recovery." },
};

const MON = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function fmtDate(iso: string): string {
  const d = parseDate(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

const PRIORITY_COLOR: Record<string, string> = {
  A: "var(--lime)",
  B: "var(--teal)",
  C: "var(--text-faint)",
};

function Dot({ active, color }: { active: boolean; color: string }) {
  return (
    <span
      className={`h-3.5 w-3.5 rounded-full transition-all ${active ? "breathe" : ""}`}
      style={{ background: active ? color : "var(--surface-3)", color: active ? color : undefined, opacity: active ? 1 : 0.4 }}
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

function RaceHeadline({ config, todayISO }: { config: TenantConfig; todayISO: string }) {
  const races = [...(config.races ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  // primary = next upcoming A race, else next upcoming, else first
  const upcoming = races.filter((r) => r.date >= todayISO);
  const primary = upcoming.find((r) => r.priority === "A") ?? upcoming[0] ?? races[0];
  const days = primary ? daysBetween(todayISO, primary.date) : null;

  return (
    <div>
      <div className="flex items-end gap-3">
        <span className="dsp tnum text-[64px] font-extrabold leading-[0.9] text-[var(--text)]">{days ?? "—"}</span>
        <span className="mb-1 text-[15px] font-semibold leading-tight text-[var(--text-muted)]">
          dias para<br />
          <span className="text-[var(--text)]">{primary?.name ?? "a prova"}</span>
        </span>
      </div>
      <div className="mt-4 space-y-1.5">
        {races.map((r) => {
          const d = daysBetween(todayISO, r.date);
          const past = d < 0;
          return (
            <div key={r.name} className="flex items-center gap-2.5 text-[12.5px]">
              <span
                className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md text-[10px] font-extrabold"
                style={{ background: "color-mix(in oklab, " + PRIORITY_COLOR[r.priority] + " 22%, transparent)", color: PRIORITY_COLOR[r.priority] }}
              >
                {r.priority}
              </span>
              <span className={`flex-1 truncate ${past ? "text-[var(--text-faint)] line-through" : "text-[var(--text-2)]"}`}>{r.name}</span>
              <span className="tnum text-[var(--text-faint)]">{fmtDate(r.date)}</span>
              <span className="tnum w-[64px] text-right font-semibold" style={{ color: past ? "var(--text-faint)" : "var(--text-muted)" }}>
                {past ? "concluída" : `${d} d`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CycleHeadline({ config, todayISO }: { config: TenantConfig; todayISO: string }) {
  const c = config.cycle!;
  const elapsedDays = Math.max(0, daysBetween(c.startDate, todayISO));
  const week = Math.min(c.weeks, Math.floor(elapsedDays / 7) + 1);

  // find current phase by accumulating phase weeks
  let acc = 0;
  let current = c.phases[0];
  for (const ph of c.phases) {
    if (week <= acc + ph.weeks) { current = ph; break; }
    acc += ph.weeks;
  }
  const pct = Math.round((week / c.weeks) * 100);

  return (
    <div>
      <div className="flex items-end gap-3">
        <span className="dsp tnum text-[64px] font-extrabold leading-[0.9] text-[var(--text)]">{week}</span>
        <span className="mb-1 text-[15px] font-semibold leading-tight text-[var(--text-muted)]">
          semana<br />
          <span className="text-[var(--text)]">de {c.weeks}</span>
        </span>
      </div>
      <p className="mt-3 text-[13px] text-[var(--text-muted)]">
        {c.name} · <span className="font-semibold text-[var(--text-2)]">Fase {current.name}</span>
      </p>
      <p className="text-[12px] text-[var(--text-faint)]">{current.focus}</p>
      <div className="mt-3 h-[5px] w-full max-w-[320px] overflow-hidden rounded-full bg-[var(--bg-soft)]">
        <div className="h-full rounded-full bg-[var(--lime)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function DemoHero({ config, data, todayISO }: { config: TenantConfig; data: DashboardData; todayISO: string }) {
  const latest = data.checkins.length ? data.checkins[data.checkins.length - 1] : null;
  const rec = latest?.recommendation ?? null;
  const meta = rec ? READY_META[rec] : null;
  const has = (m: Metric) => config.metrics.includes(m);
  const showReadiness = has("readiness");

  return (
    <div
      className="rise tcard grid grid-cols-1 gap-5 rounded-[var(--radius)] border border-[var(--border-soft)] p-6 shadow-[var(--shadow)] sm:grid-cols-[1fr_auto] sm:items-center sm:p-8"
      style={{
        background:
          "radial-gradient(560px 220px at 88% -10%, color-mix(in oklab, var(--lime) 6%, transparent), transparent 70%), linear-gradient(180deg, var(--surface-2), var(--surface))",
      }}
    >
      <div>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--lime)]">
          <span className="breathe inline-block h-1.5 w-1.5 rounded-full bg-[var(--lime)] text-[var(--lime)]" />
          {config.athlete} · {config.device}
        </p>
        {config.mode === "race" ? <RaceHeadline config={config} todayISO={todayISO} /> : <CycleHeadline config={config} todayISO={todayISO} />}
      </div>

      {showReadiness && (
        <div className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-soft)]/70 p-4 sm:min-w-[264px]">
          <div className="flex flex-col items-center gap-2">
            <Dot active={rec === "green"} color="var(--good)" />
            <Dot active={rec === "yellow"} color="var(--warn)" />
            <Dot active={rec === "red"} color="var(--bad)" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">Readiness hoje</p>
            <p className="dsp mt-0.5 text-[26px] font-extrabold leading-none" style={{ color: meta?.color ?? "var(--text-muted)" }}>
              {meta?.label ?? "NO DATA"}
            </p>
            {latest && (
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                {latest.readiness_score != null && <Stat label="Score" value={latest.readiness_score} />}
                {has("hrv") && <Stat label="HRV" value={latest.hrv} />}
                {has("body_battery") && <Stat label="Battery" value={latest.body_battery} />}
                {has("sleep") && <Stat label="Sleep" value={fmtSleepHours(latest.sleep_hours)} />}
              </div>
            )}
            <p className="mt-2 text-[12px] text-[var(--text-faint)]">{meta?.hint ?? "Sem check-in hoje."}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Build Phase[] from a training cycle so the Season block can render it. */
export function cycleToPhases(config: TenantConfig) {
  const c = config.cycle;
  if (!c) return [];
  const colors = ["#2dd4bf", "#c6f24e", "#f4a24e", "#4fb8ff"];
  let cursor = parseDate(c.startDate);
  return c.phases.map((ph, i) => {
    const start = cursor;
    const end = addDays(start, ph.weeks * 7 - 1);
    cursor = addDays(end, 1);
    return {
      id: `cy${i}`,
      name: ph.name,
      start_date: toISO(start),
      end_date: toISO(end),
      focus: ph.focus,
      color: colors[i % colors.length],
    };
  });
}
