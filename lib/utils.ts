import { RACE_DATE, type Discipline, type MuscleGroup, type Recommendation, type StrengthSession } from "./types";

// ---- dates -----------------------------------------------------------------

/** Parse a YYYY-MM-DD string as a *local* date (no timezone drift). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysUntilRace(from = new Date()): number {
  const race = parseDate(RACE_DATE);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((race.getTime() - start.getTime()) / 86_400_000);
}

export function weeksAndDaysUntilRace(from = new Date()): { weeks: number; days: number; total: number } {
  const total = Math.max(0, daysUntilRace(from));
  return { weeks: Math.floor(total / 7), days: total % 7, total };
}

/** Monday-anchored start of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sun
  const diff = (day + 6) % 7; // days since Monday
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
  return s;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function weekdayShort(d: Date): string {
  return WD[(d.getDay() + 6) % 7];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDayMonth(iso: string): string {
  const d = parseDate(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
export function monthName(m: number): string {
  return MONTHS[m];
}

/** "05 Jul 2026" — used in chart tooltips where the year matters. */
export function fmtFullDate(iso: string): string {
  const d = parseDate(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDuration(min: number | null | undefined): string {
  if (!min) return "—";
  const total = Math.round(min); // actual_duration_min can be decimal (25.6)
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m}min`;
}

/** Decimal hours → "5h38" (5.63 would otherwise render as the unreadable "5.63h"). */
export function fmtSleepHours(hours: number | null | undefined): string {
  if (hours == null) return "—";
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

// ---- discipline metadata ---------------------------------------------------

export const DISCIPLINE_META: Record<Discipline, { label: string; color: string; icon: string }> = {
  swim: { label: "Swim", color: "var(--swim)", icon: "swim" },
  bike: { label: "Bike", color: "var(--bike)", icon: "bike" },
  run: { label: "Run", color: "var(--run)", icon: "run" },
  strength: { label: "Strength", color: "var(--strength)", icon: "strength" },
  rest: { label: "Rest", color: "var(--rest)", icon: "rest" },
};

export const READINESS_META: Record<Recommendation, { label: string; color: string; hint: string }> = {
  green: { label: "Ready", color: "var(--good)", hint: "Follow the plan" },
  yellow: { label: "Caution", color: "var(--warn)", hint: "Ease the intensity" },
  red: { label: "Recover", color: "var(--bad)", hint: "Prioritise recovery" },
};

// ---- aggregations ----------------------------------------------------------

/** Count muscle-group appearances across strength sessions in the last `days`. */
export function muscleUsage(sessions: StrengthSession[], days = 7, from = new Date()): Record<string, number> {
  const cutoff = addDays(new Date(from.getFullYear(), from.getMonth(), from.getDate()), -days + 1);
  const counts: Record<string, number> = {};
  for (const s of sessions) {
    if (parseDate(s.date) < cutoff) continue;
    for (const g of s.muscle_groups) counts[g] = (counts[g] ?? 0) + 1;
  }
  return counts;
}

/** Map a usage count to a 0..1 intensity given the max in the set. */
export function usageIntensity(count: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, count / max);
}

export type Muscle = MuscleGroup;

export function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
