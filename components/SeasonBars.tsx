import type { Phase, PerformanceMilestone, TrainingLoad } from "@/lib/types";
import { parseDate, toISO, addDays, startOfWeek, fmtDayMonth } from "@/lib/utils";

const METRIC_LABEL: Record<string, string> = {
  FTP: "FTP", swim_pace_100m: "Swim CSS", run_pace_threshold: "Run LT", prova_prep: "Race prep",
};

// approximate planned weekly volume (TSS-ish) per phase — used for future weeks
const EST: Record<string, number> = { Base: 300, Build: 430, Peak: 480, Taper: 250, Race: 110 };

export function SeasonBars({
  phases, trainingLoad, milestones, todayISO,
}: {
  phases: Phase[];
  trainingLoad: TrainingLoad[];
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

  // weekly real TSS
  const weeklyTss: Record<string, number> = {};
  for (const tl of trainingLoad) {
    const wk = toISO(startOfWeek(parseDate(tl.date)));
    weeklyTss[wk] = (weeklyTss[wk] ?? 0) + Number(tl.tss ?? 0);
  }

  const phaseFor = (t: number): Phase =>
    phases.find((p) => t >= parseDate(p.start_date).getTime() && t <= parseDate(p.end_date).getTime()) ??
    phases.reduce((a, b) => (parseDate(b.start_date).getTime() <= t ? b : a), phases[0]);

  // build weeks
  let cur = startOfWeek(parseDate(phases[0].start_date));
  const weeks: { wkStart: Date; phase: Phase; vol: number; isPast: boolean; isCurrent: boolean }[] = [];
  let idx = 0;
  while (cur.getTime() <= max) {
    const wkISO = toISO(cur);
    const mid = addDays(cur, 3).getTime();
    const phase = phaseFor(mid);
    const isCurrent = todayT >= cur.getTime() && todayT < addDays(cur, 7).getTime();
    const isPast = addDays(cur, 6).getTime() < todayT;
    const recovery = idx % 4 === 3 ? 0.7 : 1;
    const realTss = weeklyTss[wkISO] ?? 0;
    const est = (EST[phase.name] ?? 250) * recovery;
    const vol = (isPast || isCurrent) && realTss > 0 ? realTss : est;
    weeks.push({ wkStart: new Date(cur), phase, vol, isPast, isCurrent });
    cur = addDays(cur, 7);
    idx++;
  }
  const maxVol = Math.max(1, ...weeks.map((w) => w.vol));

  const legend = [...new Map(phases.map((p) => [p.name, p.color])).entries()];

  return (
    <div>
      {/* header row */}
      <div className="mb-3 flex items-center justify-between">
        <span />
        <span className="dsp text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--lime)]">
          Race · {fmtDayMonth(phases[phases.length - 1].end_date).toUpperCase()}
        </span>
      </div>

      {/* bars */}
      <div className="relative">
        <div className="flex h-[86px] items-end gap-[3px]">
          {weeks.map((w, i) => {
            const h = Math.max(6, (w.vol / maxVol) * 100);
            const color = w.phase.color ?? "var(--lime)";
            return (
              <div
                key={i}
                className="growbar flex-1 rounded-[3px]"
                style={{
                  height: `${h}%`,
                  animationDelay: `${i * 22}ms`,
                  background: w.isCurrent ? "var(--lime)" : color,
                  opacity: w.isCurrent ? 1 : w.isPast ? 0.85 : 0.4,
                  boxShadow: w.isCurrent ? "0 0 12px var(--lime)" : "none",
                }}
                title={`${w.phase.name} · week of ${fmtDayMonth(toISO(w.wkStart))}`}
              />
            );
          })}
        </div>
        {/* today marker */}
        <div className="pointer-events-none absolute -top-2 bottom-0" style={{ left: `${Math.min(100, Math.max(0, pct(todayT)))}%` }}>
          <div className="mx-auto h-2 w-2 -translate-x-1/2 rounded-full border-2 border-[var(--bg)] bg-white" />
          <div className="h-[86px] w-px -translate-x-1/2 bg-white/40" />
        </div>
      </div>

      {/* phase legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {legend.map(([name, color]) => (
          <span key={name} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
            <span className="h-2 w-2 rounded-full" style={{ background: color ?? "var(--lime)" }} />
            {name}
          </span>
        ))}
      </div>

      {/* milestones */}
      <div className="relative mt-3 h-14">
        {[...milestones].sort((a, b) => (a.date < b.date ? -1 : 1)).map((m, i) => {
          const left = Math.min(96, Math.max(1, pct(parseDate(m.date).getTime())));
          const past = parseDate(m.date).getTime() < todayT;
          return (
            <div key={m.id} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${left}%`, top: i % 2 ? 26 : 0 }}>
              <span className="h-2 w-2 rounded-full" style={{ background: past ? "var(--lime)" : "var(--text-faint)" }} />
              <span className="mt-1 whitespace-nowrap text-[10px] font-medium text-[var(--text-muted)]">
                {METRIC_LABEL[m.metric] ?? m.metric}
                {m.value ? ` ${m.value}${m.unit && m.unit.length <= 2 ? m.unit : ""}` : ""}
              </span>
              <span className="tnum text-[9px] text-[var(--text-faint)]">{fmtDayMonth(m.date)}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex justify-between text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
        <span>{fmtDayMonth(phases[0].start_date)}</span>
        <span className="text-[var(--lime)]">Race day · {fmtDayMonth(phases[phases.length - 1].end_date)}</span>
      </div>
    </div>
  );
}
