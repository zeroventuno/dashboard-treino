"use client";

import { useMemo, useState } from "react";
import type { Workout, Discipline } from "@/lib/types";
import { DISCIPLINE_META, fmtDuration, parseDate, startOfWeek, addDays, toISO, monthName } from "@/lib/utils";
import { DisciplineIcon } from "./Icons";
import { WorkoutModal } from "./WorkoutModal";

const LEGEND: Discipline[] = ["swim", "bike", "run", "strength"];
const WD = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
// disciplines that get a weekly km total (strength has no distance)
const KM_DISCIPLINES: Discipline[] = ["swim", "bike", "run"];

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}

function fmtKm(km: number): string {
  return `${km % 1 === 0 ? km : km.toFixed(1)} km`;
}

interface WeekData {
  days: { iso: string; date: Date; inMonth: boolean; items: Workout[] }[];
  wk: number;
  min: number;
  tss: number;
  km: Record<Discipline, number>;
  done: number;
  total: number;
  isThis: boolean;
}

export function CalendarBoard({ workouts, todayISO }: { workouts: Workout[]; todayISO: string }) {
  const today = parseDate(todayISO);
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [open, setOpen] = useState<Workout | null>(null);

  const byDate = useMemo(() => {
    const map: Record<string, Workout[]> = {};
    for (const w of workouts) (map[w.date] ??= []).push(w);
    return map;
  }, [workouts]);

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
      for (const w of items) {
        const d = Number(w.actual_distance_km ?? w.planned_distance_km ?? 0);
        if (d > 0) km[w.discipline] += d;
      }
      out.push({
        days,
        wk: isoWeek(cur),
        min: items.reduce((s, w) => s + Number(w.actual_duration_min ?? w.planned_duration_min ?? 0), 0),
        tss: items.reduce((s, w) => s + Number(w.actual_tss ?? w.planned_tss ?? 0), 0),
        km,
        done: items.filter((w) => w.status === "done").length,
        total: items.length,
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
          <span className="dsp min-w-[140px] text-center text-[16px] font-bold text-[var(--text)]">{monthName(ym.m)} {ym.y}</span>
          <button onClick={() => shift(1)} className="grid h-[30px] w-[30px] place-items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] transition-colors hover:border-[var(--text-faint)] hover:text-[var(--text)]">›</button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {LEGEND.map((d) => (
            <span key={d} className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
              <span className="h-2 w-2 rounded-full" style={{ background: DISCIPLINE_META[d].color }} />
              {DISCIPLINE_META[d].label}
            </span>
          ))}
        </div>
      </div>

      {/* grid (scrolls horizontally on small screens) */}
      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_182px] gap-1.5">
            {WD.map((d) => (
              <div key={d} className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{d}</div>
            ))}
            <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">Week</div>

            {weeks.map((week) => (
              <WeekRow key={week.days[0].iso} week={week} todayISO={todayISO} onOpen={setOpen} />
            ))}
          </div>
        </div>
      </div>

      {open && <WorkoutModal w={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function WeekRow({ week, todayISO, onOpen }: {
  week: WeekData;
  todayISO: string;
  onOpen: (w: Workout) => void;
}) {
  return (
    <>
      {week.days.map((day) => {
        const isToday = day.iso === todayISO;
        return (
          <div
            key={day.iso}
            className="min-h-[92px] rounded-[12px] border p-1.5"
            style={{
              borderColor: isToday ? "color-mix(in oklab, var(--lime) 55%, var(--border))" : "var(--border-soft)",
              background: day.inMonth ? "var(--surface-2)" : "transparent",
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
                const meta = DISCIPLINE_META[w.discipline];
                return (
                  <button
                    key={w.id}
                    onClick={() => onOpen(w)}
                    className="group flex w-full items-center gap-1 rounded-md border-l-2 bg-[var(--surface-3)] px-1.5 py-1 text-left transition-[background-color,transform] duration-150 hover:scale-[1.03] hover:bg-[var(--border)]"
                    style={{ borderColor: meta.color }}
                  >
                    <DisciplineIcon discipline={w.discipline} size={11} style={{ color: meta.color, flexShrink: 0 }} />
                    <span className={`flex-1 truncate text-[10.5px] leading-tight ${w.status === "skipped" ? "text-[var(--text-faint)] line-through" : "text-[var(--text-2)]"}`}>{w.title}</span>
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
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">Week {week.wk}</p>
          {week.isThis && (
            <span className="rounded-full bg-[var(--lime)] px-1.5 py-[1px] text-[8px] font-bold uppercase tracking-wide text-[#0a0b0d]">This week</span>
          )}
        </div>
        <p className="dsp tnum mt-0.5 text-[22px] font-extrabold leading-none text-[var(--text)]">
          {fmtDuration(week.min) === "—" ? "0h" : fmtDuration(week.min)}
        </p>

        {/* per-discipline km totals — colored to match the legend */}
        {KM_DISCIPLINES.some((d) => week.km[d] > 0) && (
          <div className="mt-2 space-y-0.5">
            {KM_DISCIPLINES.filter((d) => week.km[d] > 0).map((d) => (
              <div key={d} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: DISCIPLINE_META[d].color }} />
                <span className="tnum text-[11px] text-[var(--text-muted)]">
                  {fmtKm(week.km[d])} {DISCIPLINE_META[d].label.toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 h-[4px] w-full overflow-hidden rounded-full bg-[#1a1d23]">
          <div className="h-full rounded-full bg-[var(--lime)]" style={{ width: `${week.total ? (week.done / week.total) * 100 : 0}%` }} />
        </div>
        <p className="tnum mt-1.5 text-[11px] text-[var(--text-muted)]">{Math.round(week.tss)} TSS · {week.done}/{week.total} done</p>
      </div>
    </>
  );
}
