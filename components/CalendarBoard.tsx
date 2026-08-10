"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PerformanceIndicators, Workout, Discipline } from "@/lib/types";
import type { Equipment } from "@/lib/prescription";
import { DISCIPLINE_META, disciplineMeta, fmtDuration, parseDate, startOfWeek, addDays, toISO, toDistance, distanceUnit, computeAdherence, avg, type Units } from "@/lib/utils";
import { DisciplineIcon } from "./Icons";
import { WorkoutModal } from "./WorkoutModal";
import { AdherenceDonut } from "./AdherenceDonut";
import { DEFAULT_LOCALE, translator, type Locale, type T } from "@/lib/i18n";

const LEGEND: Discipline[] = ["swim", "bike", "run", "strength"];

/** Localized Mon→Sun short weekday names (2026-01-05 is a Monday). */
function weekdayNames(locale: Locale): string[] {
  const f = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2026, 0, 5 + i)));
}
// disciplines that get a weekly km total (strength has no distance)
const KM_DISCIPLINES: Discipline[] = ["swim", "bike", "run"];

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}

function fmtKm(km: number, units: Units): string {
  const v = toDistance(km, units);
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${distanceUnit(units)}`;
}

interface WeekData {
  days: { iso: string; date: Date; inMonth: boolean; items: Workout[] }[];
  wk: number;
  doneMin: number;
  plannedMin: number;
  doneTss: number;
  plannedTss: number;
  km: Record<Discipline, number>; // done only (planned distance is often unset)
  done: number; // completed workouts of the plan (x)
  total: number; // scheduled workouts in the plan (y)
  adherence: number | null; // mean 0-100 over done workouts that have a score
  isThis: boolean;
}

// Rescheduled / cancelled workouts are out of every total (moved leaves a
// struck-through duplicate; cancelled is off the plan). Everything else counts.
const OUT_OF_PLAN = new Set<string>(["moved", "cancelled"]);

export function CalendarBoard({
  workouts,
  todayISO,
  ftpWatts = null,
  indicators = null,
  equipment = [],
  locale = DEFAULT_LOCALE,
  units = "metric",
  editable = false,
}: {
  workouts: Workout[];
  todayISO: string;
  locale?: Locale;
  units?: Units;
  /** Athlete's threshold power — converts .zwo power fractions into watts. */
  ftpWatts?: number | null;
  /** Zone tables + what the athlete can measure, so a block prescribed as a
   * bare percentage reaches them in watts, pace, bpm or RPE. */
  indicators?: PerformanceIndicators | null;
  equipment?: Equipment[];
  /** Viewer owns this dashboard → sessions can be dragged to another day. */
  editable?: boolean;
}) {
  const tr = translator(locale);
  const router = useRouter();
  const WD = useMemo(() => weekdayNames(locale), [locale]);
  const today = parseDate(todayISO);
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [open, setOpen] = useState<Workout | null>(null);
  const [dragging, setDragging] = useState<Workout | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  // Optimistic view of the move: the grid updates on drop, then router.refresh()
  // brings the server's version and this override is dropped.
  const [override, setOverride] = useState<Workout[] | null>(null);
  const [moveError, setMoveError] = useState(false);

  useEffect(() => { setOverride(null); }, [workouts]);

  const effective = override ?? workouts;

  const byDate = useMemo(() => {
    const map: Record<string, Workout[]> = {};
    for (const w of effective) (map[w.date] ??= []).push(w);
    return map;
  }, [effective]);

  /** A session that hasn't happened yet can be rescheduled; `done` is a fact
   * about a day, and cancelled/moved are already out of the plan. */
  const canDrag = (w: Workout) => editable && (w.status === "planned" || w.status === "skipped");

  async function moveTo(w: Workout, iso: string) {
    if (w.date === iso) return;
    setMoveError(false);
    // Same model the briefing teaches the AI: original stays, struck through as
    // `moved`; a planned copy appears on the new day.
    setOverride([
      ...effective.map((x) => (x.id === w.id ? { ...x, status: "moved" as const } : x)),
      { ...w, id: `pending-${w.id}`, date: iso, status: "planned" as const },
    ]);
    try {
      const res = await fetch("/api/app/workouts/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: w.id, date: iso }),
      });
      if (!res.ok) throw new Error("move failed");
      router.refresh();
    } catch {
      setOverride(null); // put it back where it was
      setMoveError(true);
    }
  }

  const weeks = useMemo<WeekData[]>(() => {
    const firstOfMonth = new Date(ym.y, ym.m, 1);
    const lastOfMonth = new Date(ym.y, ym.m + 1, 0);
    let cur = startOfWeek(firstOfMonth);
    const out: WeekData[] = [];
    while (cur <= lastOfMonth) {
      const days = Array.from({ length: 7 }, (_, i) => {
        const date = addDays(cur, i);
        const iso = toISO(date);
        return { iso, date, inMonth: date.getMonth() === ym.m, items: byDate[iso] ?? [] };
      });
      const items = days.flatMap((d) => d.items);
      const km = { swim: 0, bike: 0, run: 0, strength: 0, rest: 0 } as Record<Discipline, number>;
      let doneMin = 0;
      let plannedMin = 0;
      let doneTss = 0;
      let plannedTss = 0;
      let done = 0;
      let total = 0;
      const adherenceScores: number[] = [];
      for (const w of items) {
        if (OUT_OF_PLAN.has(w.status)) continue; // moved/cancelled: out of everything
        const isDone = w.status === "done";
        // Done volume = what actually happened, incl. unscheduled extras. This is
        // why a rescheduled (moved) session no longer double-counts: only `done`
        // work is summed, and the struck-through original isn't done.
        if (isDone) {
          doneMin += Number(w.actual_duration_min ?? w.planned_duration_min ?? 0);
          doneTss += Number(w.actual_tss ?? w.planned_tss ?? 0);
          const d = Number(w.actual_distance_km ?? w.planned_distance_km ?? 0);
          if (d > 0) km[w.discipline] += d;
          const a = computeAdherence(w);
          if (a != null) adherenceScores.push(a);
        }
        // The scheduled plan (x/y + the "programmed" targets) excludes extras.
        if (!w.extra) {
          plannedMin += Number(w.planned_duration_min ?? 0);
          plannedTss += Number(w.planned_tss ?? 0);
          total += 1;
          if (isDone) done += 1;
        }
      }
      out.push({
        days,
        wk: isoWeek(cur),
        doneMin,
        plannedMin,
        doneTss,
        plannedTss,
        km,
        done,
        total,
        adherence: adherenceScores.length ? Math.round(avg(adherenceScores)) : null,
        isThis: days.some((d) => d.iso === todayISO),
      });
      cur = addDays(cur, 7);
    }
    return out;
  }, [ym, byDate, todayISO]);

  const shift = (delta: number) => setYm(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  return (
    <>
      {/* controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="grid h-[30px] w-[30px] place-items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] transition-colors hover:border-[var(--text-faint)] hover:text-[var(--text)]">‹</button>
          <span className="dsp min-w-[140px] text-center text-[16px] font-bold text-[var(--text)]">{new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(ym.y, ym.m, 1))} {ym.y}</span>
          <button onClick={() => shift(1)} className="grid h-[30px] w-[30px] place-items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] transition-colors hover:border-[var(--text-faint)] hover:text-[var(--text)]">›</button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {LEGEND.map((d) => (
            <span key={d} className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
              <span className="h-2 w-2 rounded-full" style={{ background: DISCIPLINE_META[d].color }} />
              {tr(DISCIPLINE_META[d].i18nKey)}
            </span>
          ))}
        </div>
      </div>

      {editable && (
        <p className="mb-2 text-[11.5px] text-[var(--text-faint)]">
          {moveError ? <span className="text-[var(--bad)]">{tr("calendar.moveError")}</span> : tr("calendar.dragHint")}
        </p>
      )}

      {/* grid (scrolls horizontally on small screens) */}
      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_182px] gap-1.5">
            {WD.map((d) => (
              <div key={d} className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{d}</div>
            ))}
            <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{tr("calendar.week")}</div>

            {weeks.map((week) => (
              <WeekRow
                key={week.days[0].iso}
                week={week}
                todayISO={todayISO}
                tr={tr}
                units={units}
                onOpen={setOpen}
                canDrag={canDrag}
                dragging={dragging}
                overDate={overDate}
                onDragStart={setDragging}
                onDragEnd={() => { setDragging(null); setOverDate(null); }}
                onDragOverDay={setOverDate}
                onDropDay={(iso) => {
                  const w = dragging;
                  setDragging(null);
                  setOverDate(null);
                  if (w) void moveTo(w, iso);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {open && (
        <WorkoutModal
          w={open}
          ftpWatts={ftpWatts}
          indicators={indicators}
          equipment={equipment}
          locale={locale}
          units={units}
          onClose={() => setOpen(null)}
          // Touch devices don't do HTML5 drag — the modal's date picker is the
          // path that works everywhere (and with a keyboard).
          onMove={
            canDrag(open)
              ? (iso) => { const w = open; setOpen(null); void moveTo(w, iso); }
              : undefined
          }
        />
      )}
    </>
  );
}

function WeekRow({
  week, todayISO, tr, units, onOpen,
  canDrag, dragging, overDate, onDragStart, onDragEnd, onDragOverDay, onDropDay,
}: {
  week: WeekData;
  todayISO: string;
  tr: T;
  units: Units;
  onOpen: (w: Workout) => void;
  canDrag: (w: Workout) => boolean;
  dragging: Workout | null;
  overDate: string | null;
  onDragStart: (w: Workout) => void;
  onDragEnd: () => void;
  onDragOverDay: (iso: string) => void;
  onDropDay: (iso: string) => void;
}) {
  return (
    <>
      {week.days.map((day) => {
        const isToday = day.iso === todayISO;
        // Only light up a day you can actually drop on (not the one you picked up from).
        const isTarget = dragging != null && dragging.date !== day.iso;
        const isOver = isTarget && overDate === day.iso;
        return (
          <div
            key={day.iso}
            onDragOver={isTarget ? (e) => { e.preventDefault(); onDragOverDay(day.iso); } : undefined}
            onDrop={isTarget ? (e) => { e.preventDefault(); onDropDay(day.iso); } : undefined}
            className="min-h-[92px] rounded-[12px] border p-1.5 transition-colors"
            style={{
              borderColor: isOver
                ? "var(--lime)"
                : isToday
                  ? "color-mix(in oklab, var(--lime) 55%, var(--border))"
                  : "var(--border-soft)",
              background: isOver
                ? "color-mix(in oklab, var(--lime) 12%, var(--surface-2))"
                : day.inMonth
                  ? "var(--surface-2)"
                  : "transparent",
              opacity: day.inMonth ? 1 : 0.45,
            }}
          >
            <div className="mb-1 flex justify-end">
              {isToday ? (
                <span className="tnum grid h-[18px] w-[18px] place-items-center rounded-full bg-[var(--lime)] text-[11px] font-bold text-[#0a0b0d]">{day.date.getDate()}</span>
              ) : (
                <span className="tnum text-[11px] text-[var(--text-faint)]">{day.date.getDate()}</span>
              )}
            </div>
            <div className="space-y-1">
              {day.items.map((w) => {
                const meta = disciplineMeta(w.discipline);
                const key = Boolean(w.key_workout);
                const draggable = canDrag(w);
                const isPending = w.id.startsWith("pending-");
                return (
                  <button
                    key={w.id}
                    onClick={() => onOpen(w)}
                    draggable={draggable}
                    onDragStart={draggable ? (e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(w); } : undefined}
                    onDragEnd={draggable ? onDragEnd : undefined}
                    title={
                      draggable
                        ? `${w.title} — ${tr("calendar.dragHint")}`
                        : key
                          ? `${tr("modal.keyWorkout")} · ${w.title}`
                          : w.title
                    }
                    className={`group flex w-full items-center gap-1 rounded-md border-l-2 px-1.5 py-1 text-left transition-[background-color,transform] duration-150 hover:scale-[1.03] hover:bg-[var(--border)] ${
                      draggable ? "cursor-grab active:cursor-grabbing" : ""
                    }`}
                    style={{
                      opacity: isPending ? 0.55 : undefined,
                      borderColor: meta.color,
                      // Key sessions read at a glance in a dense grid: a tinted
                      // ground carries further than a 9px glyph alone.
                      background: key
                        ? "color-mix(in oklab, var(--lime) 14%, var(--surface-3))"
                        : "var(--surface-3)",
                    }}
                  >
                    <DisciplineIcon discipline={w.discipline} size={11} style={{ color: meta.color, flexShrink: 0 }} />
                    {key && (
                      <span className="shrink-0 text-[9px] leading-none text-[var(--lime)]" aria-label={tr("modal.keyWorkout")}>★</span>
                    )}
                    <span
                      className={`flex-1 truncate text-[10.5px] leading-tight ${
                        w.status === "skipped" || w.status === "cancelled" || w.status === "moved"
                          ? "text-[var(--text-faint)] line-through"
                          : key
                            ? "font-semibold text-[var(--text)]"
                            : "text-[var(--text-2)]"
                      }`}
                    >
                      {w.title}
                    </span>
                    {w.status === "done" && <span className="text-[10px] text-[var(--good)]">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* week totals */}
      <div
        className="min-h-[92px] rounded-[12px] border p-2.5"
        style={{
          borderColor: week.isThis ? "color-mix(in oklab, var(--lime) 45%, var(--border))" : "var(--border-soft)",
          background: week.isThis ? "color-mix(in oklab, var(--lime) 7%, var(--bg-soft))" : "var(--bg-soft)",
          borderLeft: week.isThis ? "2.5px solid var(--lime)" : undefined,
        }}
      >
        {/* Label and badge own the full width — squeezing the donut in beside
            them wrapped "SEMANA 32" onto two lines in a 182px column. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <p className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{tr("calendar.week")} {week.wk}</p>
          {week.isThis && (
            <span className="whitespace-nowrap rounded-full bg-[var(--lime)] px-1.5 py-[1px] text-[8px] font-bold uppercase tracking-wide text-[#0a0b0d]">{tr("calendar.thisWeek")}</span>
          )}
        </div>
        {/* Adherence sits with the volume it qualifies, where there's room. */}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="dsp tnum text-[22px] font-extrabold leading-none text-[var(--text)]">
            {fmtDuration(week.doneMin) === "—" ? "0h" : fmtDuration(week.doneMin)}
            <span className="text-[13px] font-semibold text-[var(--text-faint)]">
              {" / "}
              {fmtDuration(week.plannedMin) === "—" ? "0h" : fmtDuration(week.plannedMin)}
            </span>
          </p>
          {week.adherence != null && (
            <span className="shrink-0"><AdherenceDonut score={week.adherence} size={32} /></span>
          )}
        </div>

        {/* per-discipline km totals — colored to match the legend */}
        {KM_DISCIPLINES.some((d) => week.km[d] > 0) && (
          <div className="mt-2 space-y-0.5">
            {KM_DISCIPLINES.filter((d) => week.km[d] > 0).map((d) => (
              <div key={d} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: DISCIPLINE_META[d].color }} />
                <span className="tnum text-[11px] text-[var(--text-muted)]">
                  {fmtKm(week.km[d], units)} {tr(DISCIPLINE_META[d].i18nKey).toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 h-[4px] w-full overflow-hidden rounded-full bg-[#1a1d23]">
          <div className="h-full rounded-full bg-[var(--lime)]" style={{ width: `${week.total ? (week.done / week.total) * 100 : 0}%` }} />
        </div>
        <p className="tnum mt-1.5 text-[11px] text-[var(--text-muted)]">
          {Math.round(week.doneTss)} / {Math.round(week.plannedTss)} TSS · {week.done}/{week.total} {tr("calendar.done")}
        </p>
      </div>
    </>
  );
}
