// Domain types — mirror the Supabase schema (see supabase/migrations).

export type Discipline = "swim" | "bike" | "run" | "strength" | "rest";
export type WorkoutStatus = "planned" | "done" | "skipped" | "modified";
export type Recommendation = "green" | "yellow" | "red";

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
  notes: string | null;
  nutrition_notes: string | null;
  created_at?: string;
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
}

export const RACE_DATE = "2026-10-25";
export const RACE_NAME = "IRONMAN 70.3 Costa Navarino";
