import { RACE_DATE, type Discipline, type MuscleGroup, type Recommendation, type StrengthSession, type Workout } from "./types";

// ---- dates -----------------------------------------------------------------

/** Parse a YYYY-MM-DD string as a *local* date (no timezone drift). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from one ISO date to another; negative when `toISOstr` is past. */
// ── Units ────────────────────────────────────────────────────────────────────
// Distance and weight only, for now; pace and temperature stay metric. Anything
// that isn't exactly "imperial" is treated as metric, so a bad value degrades to
// km/kg rather than breaking. The stored numbers are always metric — conversion
// happens at render, never in the database.
export type Units = "metric" | "imperial";

const KM_TO_MI = 0.621371;
const KG_TO_LB = 2.204623;

export function toDistance(km: number, units: Units): number {
  return units === "imperial" ? km * KM_TO_MI : km;
}
export function distanceUnit(units: Units): string {
  return units === "imperial" ? "mi" : "km";
}
export function toWeight(kg: number, units: Units): number {
  return units === "imperial" ? kg * KG_TO_LB : kg;
}
export function weightUnit(units: Units): string {
  return units === "imperial" ? "lb" : "kg";
}
export function toSpeed(kmh: number, units: Units): number {
  return units === "imperial" ? kmh * KM_TO_MI : kmh;
}
export function speedUnit(units: Units): string {
  return units === "imperial" ? "mph" : "km/h";
}

export function daysBetween(fromISO: string, toISOstr: string): number {
  return Math.round((parseDate(toISOstr).getTime() - parseDate(fromISO).getTime()) / 86_400_000);
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

/** `label` is the untranslated fallback; `i18nKey` is what the UI should render
 * (see lib/i18n.ts) once a locale is in hand. */
export const DISCIPLINE_META: Record<
  Discipline,
  { label: string; i18nKey: "discipline.swim" | "discipline.bike" | "discipline.run" | "discipline.strength" | "discipline.rest"; color: string; icon: string }
> = {
  swim: { label: "Swim", i18nKey: "discipline.swim", color: "var(--swim)", icon: "swim" },
  bike: { label: "Bike", i18nKey: "discipline.bike", color: "var(--bike)", icon: "bike" },
  run: { label: "Run", i18nKey: "discipline.run", color: "var(--run)", icon: "run" },
  strength: { label: "Strength", i18nKey: "discipline.strength", color: "var(--strength)", icon: "strength" },
  rest: { label: "Rest", i18nKey: "discipline.rest", color: "var(--rest)", icon: "rest" },
};

/** Shown for a discipline we don't recognise — neutral, never missing. */
const UNKNOWN_DISCIPLINE = {
  label: "—",
  i18nKey: "discipline.rest",
  color: "var(--text-faint)",
  icon: "rest",
} as const satisfies (typeof DISCIPLINE_META)[Discipline];

/**
 * Runtime-safe lookup — always use this instead of indexing DISCIPLINE_META.
 *
 * `Workout.discipline` is typed as Discipline, but that's a promise the
 * database doesn't keep: the column is plain text and the coach writes it. One
 * session saved as "cycling" instead of "bike" made the lookup undefined, and
 * reading `.color` off it threw during render — blanking the entire dashboard,
 * with no message, over a single misspelled string.
 */
export function disciplineMeta(d: string): (typeof DISCIPLINE_META)[Discipline] {
  return DISCIPLINE_META[d as Discipline] ?? UNKNOWN_DISCIPLINE;
}

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

// ── Adherence ─────────────────────────────────────────────────────────────
// A 0-100 score of how closely a DONE workout matched its plan. Overshooting is
// deviation too (90 min of a planned 60 isn't "150% adherent" — it's off-plan),
// so we score closeness, not a ratio: 1 - |actual - planned| / planned.

/** Closeness of one metric, 0..1, or null when there's nothing to compare. */
function closeness(actual: number | null | undefined, planned: number | null | undefined): number | null {
  if (planned == null || planned <= 0 || actual == null) return null;
  return Math.max(0, 1 - Math.abs(actual - planned) / planned);
}

/**
 * The adherence score for a workout, 0-100, or null when it doesn't apply
 * (not done, or a coach who gave no plan to measure against). A coach-set
 * `adherence` always wins — it's their judgment (an athlete who swapped the
 * session for something unrelated can match the duration yet score low).
 * Otherwise we estimate from actual vs planned duration, TSS and distance.
 */
export function computeAdherence(w: Workout): number | null {
  if (w.adherence != null) return clampScore(w.adherence);
  if (w.status !== "done") return null;
  const parts = [
    closeness(w.actual_duration_min, w.planned_duration_min),
    closeness(w.actual_tss, w.planned_tss),
    closeness(w.actual_distance_km, w.planned_distance_km),
  ].filter((x): x is number => x != null);
  if (!parts.length) return null;
  return Math.round(avg(parts) * 100);
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Traffic-light colour for an adherence score (CSS var). */
export function adherenceColor(score: number): string {
  if (score >= 80) return "var(--good)";
  if (score >= 55) return "var(--warn)";
  return "var(--bad)";
}
