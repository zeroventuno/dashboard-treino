// Domain types — mirror the Supabase schema (see supabase/migrations).

export type Discipline = "swim" | "bike" | "run" | "strength" | "rest";
// planned: scheduled, pending · done: completed (adherence score says how well)
// skipped: athlete no-showed · cancelled: coach removed it · moved: rescheduled
// (the struck-through original; the real one lives on the new date).
export type WorkoutStatus = "planned" | "done" | "skipped" | "cancelled" | "moved";
export type Recommendation = "green" | "yellow" | "red";

/** Seconds spent in each training zone. `z0` is prescribed time with no target
 * ("easy spin") — it exists so an open block isn't scored as if the coach had
 * asked for zone 1. Lives here rather than in lib/zone-time because it is a
 * stored column; the logic that produces it is there. */
export type ZoneSeconds = { z0: number; z1: number; z2: number; z3: number; z4: number; z5: number };

export interface TrainingLoad {
  date: string; // YYYY-MM-DD
  tss: number | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  source: "garmin" | "strava" | "manual" | null;
}

export interface Workout {
  id: string;
  date: string;
  discipline: Discipline;
  title: string;
  description: string | null;
  garmin_instructions: string | null;
  zwo_content: string | null;
  status: WorkoutStatus;
  planned_duration_min: number | null;
  actual_duration_min: number | null;
  planned_distance_km: number | null;
  actual_distance_km: number | null;
  planned_tss: number | null;
  actual_tss: number | null;
  /** Authoritative pace strings (e.g. "6:04/km", "1:53/100m") — preferred over
   * duration÷distance, which overstates swim pace (elapsed time includes rests). */
  planned_pace?: string | null;
  actual_pace?: string | null;
  /** Bike power as free text (e.g. "150-158W", "254W avg / 290W max"). */
  planned_power_watts?: string | null;
  actual_power_watts?: string | null;
  notes: string | null;
  nutrition_notes: string | null;
  /** Structured interval blocks — drives the block list + chart in the modal. */
  structure?: WorkoutBlock[] | null;
  /** One of the week's priority sessions — highlighted in the calendar. */
  key_workout?: boolean | null;
  /** Logged but not part of the plan (an unscheduled extra session). Counts in
   * the week's done volume — time/distance/TSS — but NOT in the x/y adherence. */
  extra?: boolean | null;
  /** 0-100: how well a DONE workout matched the plan. Set by the coach (their
   * judgment); if null, the dashboard scores it from time in zone when the
   * device gave us one, and falls back to actual vs planned duration/TSS/
   * distance when it didn't. Only meaningful when status is "done". */
  adherence?: number | null;
  /** Seconds per zone actually recorded, reduced from the device's stream at
   * import time. The per-second stream itself is not kept: this handful of
   * numbers is what a coach reads, and it's what makes "did the volume, missed
   * the intensity" visible. */
  actual_zones?: (ZoneSeconds & { metric?: string }) | null;
  /** How hard the session actually felt, Borg CR10 (0-10). The only reading an
   * athlete with no device can give, and the one their score depends on. */
  actual_rpe?: number | null;
  /** Pre-workout: activation/warm-up routine and fueling. */
  activation?: string | null;
  nutrition_pre?: string | null;
  /** Post-workout: cool-down/mobility and refuelling. */
  mobility?: string | null;
  nutrition_post?: string | null;
  created_at?: string;
}

/** One interval of a workout. `intensity` is % of threshold (FTP/CSS/pace) and
 * only scales the chart; `target` is the human-readable prescription. */
export interface WorkoutBlock {
  label: string;
  duration_min: number;
  intensity?: number | null;
  target?: string | null;
  note?: string | null;
}

export interface Phase {
  id: string;
  name: string; // Base | Build | Peak | Taper | Race
  start_date: string;
  end_date: string;
  focus: string | null;
  color: string | null; // hex
}

export interface PerformanceMilestone {
  id: string;
  date: string;
  metric: string;
  value: number | null;
  unit: string | null;
  notes: string | null;
}

export interface PerformanceIndicators {
  id: string;
  updated_at: string;
  ftp_watts: number | null;
  bike_zones: Record<string, [number, number] | string> | null;
  run_pace_zones: Record<string, string> | null;
  swim_pace_per_100m: string | null;
  swim_pace_zones: Record<string, string> | null;
  run_threshold_pace: string | null;
  cadence_run_target: number | null;
  hr_zones: Record<string, [number, number] | string> | null;
}

export type MuscleGroup =
  | "quadriceps" | "glutes" | "hamstrings" | "core"
  | "shoulders" | "back" | "calves" | "chest" | "biceps" | "triceps";

export interface StrengthSession {
  id: string;
  date: string;
  muscle_groups: MuscleGroup[];
  exercises: { name: string; sets: number; reps: string; load?: string }[] | null;
  notes: string | null;
}

export interface Checkin {
  date: string;
  hrv: number | null;
  sleep_hours: number | null;
  readiness_score: number | null;
  body_battery: number | null;
  resting_hr: number | null;
  recommendation: Recommendation | null;
  notes: string | null;
  hydration_liters: number | null;
  whey_shakes: number | null;
  protein_grams_estimate: number | null;
}

export interface InjuryEntry {
  id: string;
  date: string;
  area: string;
  severity: number | null; // 1-5
  notes: string | null;
}

export interface BodyComposition {
  date: string;
  weight_kg: number | null;
  muscle_mass_kg: number | null;
  body_fat_pct: number | null;
  lean_mass_kg: number | null;
  visceral_fat: number | null;
  metabolic_age: number | null;
  notes: string | null;
}

export interface DailyMeal {
  id: string;
  meal_order: number;
  meal_name: string;
  time_suggestion: string | null;
  foods: string | null; // newline-separated
  protein_g: number | null;
  carbs_g: number | null;
  notes: string | null;
}

export type DurationCategory = "curto" | "medio" | "longo" | "muito_longo";

export interface NutritionRule {
  id: string;
  duration_category: DurationCategory | string;
  duration_range: string | null;
  discipline_context: string | null;
  before_training: string | null;
  during_training: string | null;
  after_training: string | null;
  supplements_used: string[] | null;
  notes: string | null;
}

/** Opt-in menstrual-cycle tracking (female athletes who ask for it). One config
 * row per athlete: the dashboard derives today's cycle day, the current phase
 * and the predicted next period from these three numbers — the coach only keeps
 * `last_period_start` current. Sensitive health data: gated behind the
 * "menstrual" metric, isolated by RLS like every other table. */
export interface MenstrualCycle {
  last_period_start: string; // YYYY-MM-DD, day 1 of the most recent period
  cycle_length: number;      // average length in days (typical 28)
  period_length: number;     // average bleeding days (typical 4-5)
  notes: string | null;      // coach's context, in the athlete's language
}

export interface DashboardData {
  trainingLoad: TrainingLoad[];
  workouts: Workout[];
  phases: Phase[];
  milestones: PerformanceMilestone[];
  indicators: PerformanceIndicators | null;
  strength: StrengthSession[];
  checkins: Checkin[];
  injuries: InjuryEntry[];
  bodyComposition: BodyComposition[];
  mealPlan: DailyMeal[];
  nutritionRules: NutritionRule[];
  // Optional: only the product dashboard (multi-tenant) populates this, and
  // only for athletes who opted in. The personal dashboard leaves it undefined.
  menstrualCycle?: MenstrualCycle | null;
}

export const RACE_DATE = "2026-10-25";
export const RACE_NAME = "IRONMAN 70.3 Costa Navarino";
