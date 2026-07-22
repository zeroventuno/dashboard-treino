import {
  RACE_DATE as RACE_DATE_DEFAULT,
  RACE_NAME as RACE_NAME_DEFAULT,
  type DashboardData,
} from "@/lib/types";
import { daysBetween, fmtSleepHours, parseDate, toISO } from "@/lib/utils";
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

/** What this athlete is training for. The name and date used to be written into
 * this component, so every tenant's dashboard counted down to the repo owner's
 * race — it must come from their own data. */
export interface HeroTarget {
  raceName: string;
  raceISO: string | null; // null → a cycle, or nothing scheduled yet
  /** Set when the athlete trains on a cycle instead of toward a race. The hero
   * then counts weeks elapsed, not days remaining — "no race scheduled" reads
   * as something missing to someone who deliberately has no race. */
  cycle?: { weeks: number; startISO: string; phases: { name: string; weeks: number; focus: string | null }[] } | null;
  /** The athlete's other target races. The coach writes A/B/C races with
   * set_races and only the primary was ever shown, so the B and C races
   * silently went nowhere. */
  races?: { name: string; date: string; priority: string }[];
}

const PRIORITY_COLOR: Record<string, string> = {
  A: "var(--lime)",
  B: "var(--teal)",
  C: "var(--text-faint)",
};

function RaceList({
  races,
  locale,
  tr,
}: {
  races: NonNullable<HeroTarget["races"]>;
  locale: Locale;
  tr: ReturnType<typeof translator>;
}) {
  const todayISO = toISO(new Date());
  const byDate = [...races].sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="mt-4 space-y-1.5">
      {byDate.map((r) => {
        const d = daysBetween(todayISO, r.date);
        const past = d < 0;
        return (
          <div key={`${r.name}-${r.date}`} className="flex items-center gap-2.5 text-[12.5px]">
            <span
              className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md text-[10px] font-extrabold"
              style={{
                background: `color-mix(in oklab, ${PRIORITY_COLOR[r.priority] ?? "var(--text-faint)"} 22%, transparent)`,
                color: PRIORITY_COLOR[r.priority] ?? "var(--text-faint)",
              }}
            >
              {r.priority}
            </span>
            <span className={`flex-1 truncate ${past ? "text-[var(--text-faint)] line-through" : "text-[var(--text-2)]"}`}>
              {r.name}
            </span>
            <span className="tnum shrink-0 text-[var(--text-faint)]">
              {parseDate(r.date).toLocaleDateString(locale, { day: "numeric", month: "short" })}
            </span>
            <span
              className="tnum w-[70px] shrink-0 text-right font-semibold"
              style={{ color: past ? "var(--text-faint)" : "var(--text-muted)" }}
            >
              {past ? tr("hero.raceDone") : `${d} d`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Week N of M, and which phase that lands in. */
function cycleProgress(cycle: NonNullable<HeroTarget["cycle"]>, todayISO: string) {
  const elapsedDays = Math.max(0, daysBetween(cycle.startISO, todayISO));
  const week = Math.min(cycle.weeks, Math.floor(elapsedDays / 7) + 1);
  let acc = 0;
  let current = cycle.phases[0] ?? null;
  for (const ph of cycle.phases) {
    if (week <= acc + ph.weeks) { current = ph; break; }
    acc += ph.weeks;
  }
  return { week, current, pct: Math.round((week / Math.max(1, cycle.weeks)) * 100) };
}

function CycleProgress({
  cycle,
  tr,
}: {
  cycle: NonNullable<HeroTarget["cycle"]>;
  tr: ReturnType<typeof translator>;
}) {
  const { week, current, pct } = cycleProgress(cycle, toISO(new Date()));

  return (
    <div>
      <div className="flex items-end gap-3">
        <span className="dsp tnum text-[80px] font-black leading-[0.86] text-[var(--text)] sm:text-[104px]">
          {week}
        </span>
        <span className="mb-2.5 text-[15px] font-semibold leading-tight text-[var(--text-2)]">
          {tr("hero.week")}<br />
          {tr("hero.ofWeeks")} {cycle.weeks}
        </span>
      </div>
      {current && (
        <p className="mt-3 text-[13px] text-[var(--text-muted)]">
          {tr("hero.phase")} <span className="font-semibold text-[var(--text-2)]">{current.name}</span>
          {current.focus ? ` · ${current.focus}` : ""}
        </p>
      )}
      <div className="mt-3 h-[5px] w-full max-w-[320px] overflow-hidden rounded-full bg-[var(--bg-soft)]">
        <div className="h-full rounded-full bg-[var(--lime)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function HeroBlock({
  data,
  locale = DEFAULT_LOCALE,
  target = { raceName: RACE_NAME_DEFAULT, raceISO: RACE_DATE_DEFAULT },
}: {
  data: DashboardData;
  locale?: Locale;
  target?: HeroTarget;
}) {
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
          {target.raceName}
        </p>
        {/* No date → nothing to count down to (a cycle, or a fresh account). The
            countdown would otherwise have to invent one. */}
        {target.raceISO ? (
          <>
            <Countdown raceISO={target.raceISO} locale={locale} />
            {/* Only worth listing when there's more than the one being counted. */}
            {target.races && target.races.length > 1 && (
              <RaceList races={target.races} locale={locale} tr={tr} />
            )}
          </>
        ) : target.cycle ? (
          <CycleProgress cycle={target.cycle} tr={tr} />
        ) : (
          <p className="dsp text-[34px] font-extrabold leading-tight text-[var(--text-2)] sm:text-[44px]">
            {tr("hero.noRace")}
          </p>
        )}
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
