import type { MenstrualCycle as Cycle } from "@/lib/types";
import { translator, type Locale, type TKey } from "@/lib/i18n";
import { addDays, daysBetween, parseDate, toISO } from "@/lib/utils";

// ────────────────────────────────────────────────────────────────────────────
//  Menstrual-cycle view — derives everything from three numbers the coach keeps
//  current (last period start, average cycle length, average period length):
//  today's cycle day, the current phase, and the predicted next period. It is a
//  PREDICTION, always labelled as an estimate — real cycles vary, and this is
//  training context, not a medical instrument. Purely presentational; the coach
//  interprets and prescribes.
// ────────────────────────────────────────────────────────────────────────────

type PhaseId = "menstrual" | "follicular" | "ovulatory" | "luteal";

const PHASE_META: { id: PhaseId; color: string }[] = [
  // Colour tracks the app's phase palette and reads as an energy gradient:
  // rose (bleed) → teal (rising) → lime (peak) → amber (wind-down).
  { id: "menstrual", color: "#ef6f8e" },
  { id: "follicular", color: "#2dd4bf" },
  { id: "ovulatory", color: "#c6f24e" },
  { id: "luteal", color: "#f4a24e" },
];

interface Segment {
  id: PhaseId;
  startDay: number; // 1-indexed, inclusive
  endDay: number; // inclusive
}

/** Split a cycle of length L into four contiguous phases. The luteal phase is
 * biologically ~14 days and fairly fixed, so ovulation ≈ L − 14 and the
 * follicular phase absorbs the variation in cycle length. Everything is clamped
 * so odd inputs (a very short cycle, a long period) never overlap or crash. */
function segments(cycleLength: number, periodLength: number): Segment[] {
  const L = Math.max(Math.round(cycleLength) || 28, 4);
  const P = Math.min(Math.max(Math.round(periodLength) || 5, 1), L - 1);
  const ovulation = Math.min(L - 1, Math.max(P + 2, L - 14));
  const ovStart = Math.max(P + 1, ovulation - 1);
  const ovEnd = Math.min(L, ovulation + 1);

  const raw: Segment[] = [
    { id: "menstrual", startDay: 1, endDay: P },
    { id: "follicular", startDay: P + 1, endDay: ovStart - 1 },
    { id: "ovulatory", startDay: ovStart, endDay: ovEnd },
    { id: "luteal", startDay: ovEnd + 1, endDay: L },
  ];
  // Drop any phase the clamping squeezed to nothing.
  return raw.filter((s) => s.endDay >= s.startDay);
}

interface Derived {
  cycleLength: number;
  cycleDay: number; // 1..L
  currentPhase: PhaseId;
  segs: Segment[];
  nextPeriodISO: string;
  stale: boolean; // last_period_start is more than one cycle in the past
}

function derive(cycle: Cycle, todayISO: string): Derived {
  const L = Math.max(Math.round(cycle.cycle_length) || 28, 4);
  const delta = Math.max(0, daysBetween(cycle.last_period_start, todayISO));
  const cyclesElapsed = Math.floor(delta / L);
  const cycleDay = delta - cyclesElapsed * L + 1; // 1..L
  const currentStart = addDays(parseDate(cycle.last_period_start), cyclesElapsed * L);
  const nextPeriodISO = toISO(addDays(currentStart, L));
  const segs = segments(L, cycle.period_length);
  const currentPhase = segs.find((s) => cycleDay >= s.startDay && cycleDay <= s.endDay)?.id ?? "luteal";
  return { cycleLength: L, cycleDay, currentPhase, segs, nextPeriodISO, stale: cyclesElapsed > 0 };
}

function fmtDate(iso: string, locale: Locale): string {
  try {
    return parseDate(iso).toLocaleDateString(locale, { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

export function MenstrualCycleView({
  cycle,
  todayISO,
  locale,
}: {
  cycle: Cycle | null | undefined;
  todayISO: string;
  locale: Locale;
}) {
  const tr = translator(locale);
  const nameOf = (id: PhaseId) => tr(`menstrual.phase.${id}` as TKey);
  const hintOf = (id: PhaseId) => tr(`menstrual.hint.${id}` as TKey);

  if (!cycle?.last_period_start) {
    return <p className="text-[13px] text-[var(--text-faint)]">{tr("menstrual.empty")}</p>;
  }

  const d = derive(cycle, todayISO);
  const L = d.cycleLength;
  const activeColor = PHASE_META.find((p) => p.id === d.currentPhase)?.color ?? "#ef6f8e";
  // Marker at the centre of today's day-cell.
  const todayPct = ((d.cycleDay - 0.5) / L) * 100;

  return (
    <div>
      {/* Status: current phase + cycle day, and the predicted next period. */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: activeColor }} />
          <div>
            <p className="text-[15px] font-bold leading-tight text-[var(--text)]">{nameOf(d.currentPhase)}</p>
            <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
              {tr("menstrual.day").replace("{n}", String(d.cycleDay)).replace("{total}", String(L))}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10.5px] uppercase tracking-wide text-[var(--text-faint)]">
            {tr("menstrual.nextPeriod")}
          </p>
          <p className="tnum text-[13px] font-semibold text-[var(--text)]">
            ~ {fmtDate(d.nextPeriodISO, locale)}{" "}
            <span className="text-[10.5px] font-normal italic text-[var(--text-faint)]">({tr("menstrual.estimate")})</span>
          </p>
        </div>
      </div>

      {/* Phase bar: proportional segments with a marker at "today". */}
      <div className="relative pt-5">
        {/* today flag */}
        <div
          className="absolute top-0 z-10 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${todayPct}%` }}
        >
          <span className="rounded-full bg-[var(--text)] px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-[var(--surface)]">
            {tr("menstrual.today")}
          </span>
        </div>
        <div className="relative flex h-8 w-full overflow-hidden rounded-[var(--radius-sm)]">
          {d.segs.map((s) => {
            const days = s.endDay - s.startDay + 1;
            const color = PHASE_META.find((p) => p.id === s.id)?.color ?? "#888";
            return (
              <div
                key={s.id}
                className="h-full"
                style={{ width: `${(days / L) * 100}%`, background: color, opacity: s.id === d.currentPhase ? 1 : 0.5 }}
                title={`${nameOf(s.id)} · ${s.startDay}–${s.endDay}`}
              />
            );
          })}
          {/* today line, drawn over the segments */}
          <div
            className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-[var(--text)]"
            style={{ left: `${todayPct}%` }}
          />
        </div>
        {/* ── Day ruler ─────────────────────────────────────────────────────
            "1" at one end and "28" at the other left every day in between to
            be estimated off the bar's width. One tick per day makes the scale
            countable: a taller mark every seven days gives the week rhythm the
            phases actually follow, and today gets its own so the flag above has
            something to land on. Numbers only on the week marks — a number
            under all twenty-eight would be noise, not precision. */}
        <div className="mt-1.5 flex gap-px">
          {Array.from({ length: L }, (_, i) => {
            const day = i + 1;
            const isWeek = day === 1 || day % 7 === 0;
            const isToday = day === d.cycleDay;
            return (
              <div key={day} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className="w-px"
                  style={{
                    height: isToday ? 8 : isWeek ? 6 : 3,
                    background: isToday
                      ? "var(--text)"
                      : isWeek
                        ? "var(--text-faint)"
                        : "var(--border)",
                  }}
                />
                {(isWeek || isToday) && (
                  <span
                    className="text-[8.5px] leading-none tabular-nums"
                    style={{
                      color: isToday ? "var(--text)" : "var(--text-faint)",
                      fontWeight: isToday ? 700 : 400,
                    }}
                  >
                    {day}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend: each phase, its day range, and a one-line training tendency. */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PHASE_META.map((p) => {
          const seg = d.segs.find((s) => s.id === p.id);
          const active = p.id === d.currentPhase;
          return (
            <div
              key={p.id}
              className={`rounded-[12px] border p-2.5 ${
                active ? "border-[var(--border)] bg-[var(--surface-2)]" : "border-[var(--border-soft)] bg-transparent"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                <span className="text-[12.5px] font-bold text-[var(--text)]">{nameOf(p.id)}</span>
                {seg && (
                  <span className="tnum ml-auto text-[10.5px] text-[var(--text-faint)]">
                    {seg.startDay}–{seg.endDay}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{hintOf(p.id)}</p>
            </div>
          );
        })}
      </div>

      {d.stale && (
        <p className="mt-3 text-[11px] italic text-[var(--warn)]">{tr("menstrual.stale")}</p>
      )}
      {cycle.notes && (
        <p className="mt-3 rounded-[10px] border border-[var(--border-soft)] bg-[var(--surface-2)] p-2.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
          {cycle.notes}
        </p>
      )}
    </div>
  );
}
