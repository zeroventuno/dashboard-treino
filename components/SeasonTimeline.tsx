import type { Phase, PerformanceMilestone } from "@/lib/types";
import { parseDate, fmtDayMonth } from "@/lib/utils";

const METRIC_LABEL: Record<string, string> = {
  FTP: "FTP",
  swim_pace_100m: "Nado CSS",
  run_pace_threshold: "Limiar corrida",
  prova_prep: "Prova prep",
};

export function SeasonTimeline({
  phases, milestones, todayISO,
}: {
  phases: Phase[];
  milestones: PerformanceMilestone[];
  todayISO: string;
}) {
  if (phases.length === 0) return null;

  const starts = phases.map((p) => parseDate(p.start_date).getTime());
  const ends = phases.map((p) => parseDate(p.end_date).getTime());
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  const span = Math.max(1, max - min);
  const pct = (t: number) => ((t - min) / span) * 100;

  const todayT = parseDate(todayISO).getTime();
  const todayPct = Math.min(100, Math.max(0, pct(todayT)));

  return (
    <div>
      {/* phase bar */}
      <div className="relative">
        <div className="flex h-9 w-full overflow-hidden rounded-full border border-[var(--border)]">
          {phases.map((p) => {
            const w = (pct(parseDate(p.end_date).getTime()) - pct(parseDate(p.start_date).getTime()));
            const active = todayT >= parseDate(p.start_date).getTime() && todayT <= parseDate(p.end_date).getTime();
            return (
              <div
                key={p.id}
                className="relative flex items-center justify-center border-r border-black/20 last:border-r-0 transition-all"
                style={{
                  width: `${Math.max(w, 1.5)}%`,
                  background: active
                    ? `${p.color}`
                    : `color-mix(in oklab, ${p.color} 34%, var(--surface-2))`,
                }}
                title={`${p.name} · ${fmtDayMonth(p.start_date)}–${fmtDayMonth(p.end_date)}`}
              >
                <span
                  className="truncate px-1 text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: active ? "#0a0a0a" : "var(--text-muted)" }}
                >
                  {p.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* today marker */}
        <div className="pointer-events-none absolute -top-1 bottom-0" style={{ left: `${todayPct}%` }}>
          <div className="h-11 w-[2px] -translate-x-1/2 bg-[var(--text)]" />
          <div className="absolute -top-1 left-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-[var(--bg)] bg-[var(--text)]" />
        </div>
      </div>

      {/* milestone pins — sorted by date so adjacent pins alternate rows */}
      <div className="relative mt-3 h-14">
        {[...milestones].sort((a, b) => (a.date < b.date ? -1 : 1)).map((m, i) => {
          const left = Math.min(97, Math.max(1, pct(parseDate(m.date).getTime())));
          const past = parseDate(m.date).getTime() < todayT;
          return (
            <div
              key={m.id}
              className="absolute flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${left}%`, top: i % 2 ? 26 : 0 }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: past ? "var(--surge)" : "var(--text-faint)" }}
              />
              <span className="mt-1 whitespace-nowrap text-[10px] font-medium text-[var(--text-muted)]">
                {METRIC_LABEL[m.metric] ?? m.metric}
                {m.value ? ` ${m.value}${m.unit && m.unit.length <= 2 ? m.unit : ""}` : ""}
              </span>
              <span className="tnum text-[9px] text-[var(--text-faint)]">{fmtDayMonth(m.date)}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        <span>{fmtDayMonth(phases[0].start_date)}</span>
        <span className="text-[var(--surge)]">Prova · {fmtDayMonth(phases[phases.length - 1].end_date)}</span>
      </div>
    </div>
  );
}
