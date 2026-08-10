import type { Phase, PerformanceMilestone, TrainingLoad } from "@/lib/types";
import { parseDate, toISO, addDays, startOfWeek, fmtDayMonth } from "@/lib/utils";
import { phaseColor } from "@/lib/phases";

const METRIC_LABEL: Record<string, string> = {
  FTP: "FTP", swim_pace_100m: "Swim CSS", run_pace_threshold: "Run LT", prova_prep: "Race prep",
};

// approximate planned weekly volume (TSS-ish) per phase — used for future weeks
const EST: Record<string, number> = { Base: 300, Build: 430, Peak: 480, Taper: 250, Race: 110 };

/** The day-of-month label for a week that straddles a month boundary: the 1st
 * of the incoming month, or the week's own start on the very first bar. */
export function monthFirstDay(start: Date, end: Date): number {
  return end.getMonth() !== start.getMonth() ? 1 : start.getDate();
}

/** Consecutive weeks grouped by the month they mostly belong to.
 *
 * "Mostly" is the whole trick. A week split across two months has to be counted
 * once or the bands drift out of step with the bars above them, so it goes to
 * whichever month holds its Thursday — the midpoint, and the same rule ISO
 * weeks use to decide which year they belong to. */
export function monthSpans(weeks: { wkStart: Date; isCurrent: boolean }[]) {
  const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const out: { label: string; weeks: number; hasToday: boolean }[] = [];

  for (const w of weeks) {
    const mid = new Date(w.wkStart.getTime() + 3 * 86_400_000);
    const label = MONTHS[mid.getMonth()];
    const last = out[out.length - 1];
    if (last && last.label === label) {
      last.weeks++;
      last.hasToday ||= w.isCurrent;
    } else {
      out.push({ label, weeks: 1, hasToday: w.isCurrent });
    }
  }
  return out;
}

export function SeasonBars({
  phases, trainingLoad, milestones, todayISO,
}: {
  phases: Phase[];
  trainingLoad: TrainingLoad[];
  milestones: PerformanceMilestone[];
  todayISO: string;
}) {
  if (phases.length === 0) return null;

  // Only the last date is still needed: the bars are laid out in week columns,
  // and everything positioned over them is placed by week index.
  const max = Math.max(...phases.map((p) => parseDate(p.end_date).getTime()));
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

  /**
   * A date → its horizontal centre, in the SAME coordinate space as the bars.
   *
   * The bars are equal-width week columns starting at the Monday before the
   * season, so a marker has to be placed by week INDEX, not by how far the date
   * sits along the raw calendar span. Those two differ by however many days the
   * season starts after a Monday, and by every week the last phase runs past
   * its own end — enough to slide a race marker a full bar away from race week.
   */
  const weekPct = (t: number): number => {
    const first = weeks[0].wkStart.getTime();
    const idx = Math.floor((t - first) / (7 * 86_400_000));
    const clamped = Math.min(weeks.length - 1, Math.max(0, idx));
    return ((clamped + 0.5) / weeks.length) * 100;
  };

  const legend = [...new Map(phases.map((p) => [p.name, phaseColor(p.name, p.color)])).entries()];

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
            const color = phaseColor(w.phase.name, w.phase.color);
            const future = !w.isPast && !w.isCurrent;
            return (
              <div
                key={i}
                className="growbar flex-1 rounded-[3px]"
                style={{
                  height: `${h}%`,
                  animationDelay: `${i * 22}ms`,
                  // Done is filled, still to come is outlined — the same
                  // language the zone comparison uses for prescribed vs
                  // executed. It replaced a 40% opacity that changed the HUE:
                  // lime at 40% on this background reads khaki and blue reads
                  // slate, so the legend dot and its own bars stopped matching.
                  // An outline says "not yet" without touching the colour.
                  background: future ? "transparent" : color,
                  border: future ? `1.5px solid ${color}` : "none",
                  // Today keeps its PHASE colour and is marked by a ring
                  // instead. It used to be painted var(--lime), which the
                  // readiness tint remaps — so the current week turned orange
                  // on a yellow day and collided with the Peak phase.
                  boxShadow: w.isCurrent ? `0 0 0 2px var(--text), 0 0 10px ${color}` : "none",
                }}
                title={`${w.phase.name} · ${fmtDayMonth(toISO(w.wkStart))}`}
              />
            );
          })}
        </div>
      </div>

      {/* ── The calendar under the bars ──────────────────────────────────────
          The bars are WEEKS, so a month almost never starts where one begins.
          Labelling points on a weekly axis would put "SET" next to a bar that
          is four days of August — so months are drawn as SPANS instead, each
          one exactly as wide as the weeks it owns. The eye gets the month from
          the band and the day from the tick, without either lying.

          A tick sits under every week that contains a 1st, carrying the month's
          first day; today's week gets its own date. Everything else stays a
          hairline, so the row reads as a ruler rather than a list. */}
      <div className="mt-1.5 flex gap-[3px]">
        {weeks.map((w, i) => {
          // Does a month turn over inside this week?
          const end = new Date(w.wkStart.getTime() + 6 * 86_400_000);
          const turns = end.getMonth() !== w.wkStart.getMonth() || i === 0;
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-[3px]">
              <span
                className="w-px"
                style={{
                  height: turns ? 6 : 3,
                  background: w.isCurrent
                    ? "var(--lime)"
                    : turns
                      ? "var(--text-faint)"
                      : "var(--border)",
                }}
              />
              {(turns || w.isCurrent) && (
                <span
                  className="tnum text-[8.5px] leading-none"
                  style={{ color: w.isCurrent ? "var(--lime)" : "var(--text-faint)" }}
                >
                  {w.isCurrent ? new Date().getDate() : monthFirstDay(w.wkStart, end)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Month bands: one segment per month, spanning its weeks. Grown with
          flex-grow so they stay locked to the bars at any width — a percentage
          would drift by a pixel per week and stop lining up. */}
      <div className="mt-[3px] flex gap-[3px]">
        {monthSpans(weeks).map((m, i) => (
          <div
            key={i}
            className="flex items-center justify-center overflow-hidden border-t pt-1"
            style={{
              flexGrow: m.weeks,
              flexBasis: 0,
              borderColor: m.hasToday ? "var(--lime)" : "var(--border)",
            }}
          >
            <span
              className="truncate text-[9px] font-bold uppercase tracking-[0.1em]"
              style={{ color: m.hasToday ? "var(--lime)" : "var(--text-faint)" }}
            >
              {m.label}
            </span>
          </div>
        ))}
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

      {/* Milestones, placed in WEEK space.
          They used to be positioned over the raw span of the phase dates while
          the bars are laid out from the Monday BEFORE the season starts to the
          last week — two different origins, so every marker drifted from the
          bar it belongs to. Now a date is resolved to its week column and
          centred on it, which is the only way a dot can point at a bar. */}
      <div className="relative mt-3 h-14">
        {[...milestones].sort((a, b) => (a.date < b.date ? -1 : 1)).map((m, i) => {
          const left = weekPct(parseDate(m.date).getTime());
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
