import { z } from "zod";
import type { PoolClient } from "pg";

// ────────────────────────────────────────────────────────────────────────────
//  Shared read cores — same SELECTs feed the athlete's own key (tools.ts) and a
//  professional reading a roster athlete (staff-tools.ts). Each takes a client
//  already inside a withTenant transaction (so RLS scopes to that tenant) and
//  returns the plain object the tool serializes.
// ────────────────────────────────────────────────────────────────────────────

/** Cycle phases (jsonb {name,weeks,focus}) → dated phase bars, mirroring the
 * dashboard's cycleToPhases. UTC-based so the ISO dates are stable regardless
 * of where this runs. */
function cycleToSeason(
  startDate: string,
  phases: { name: string; weeks: number; focus?: string | null }[],
) {
  const DAY = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  let cursor = new Date(`${startDate}T00:00:00Z`).getTime();
  return phases.map((ph) => {
    const start = cursor;
    const end = start + (ph.weeks * 7 - 1) * DAY;
    cursor = end + DAY;
    return { name: ph.name, start_date: iso(start), end_date: iso(end), focus: ph.focus ?? null };
  });
}

export async function readProfile(c: PoolClient, tenantId: string) {
  const [profile, races, cycle, phasesTable, indicators, menstrual] = await Promise.all([
    c.query(
      "select athlete, devices, metrics, mode, locale, units, anatomy, preferences, updated_at from profiles where tenant_id=$1 limit 1",
      [tenantId],
    ),
    c.query("select name, date, priority from races where tenant_id=$1 order by date", [tenantId]),
    c.query(
      "select name, to_char(start_date,'YYYY-MM-DD') as start_date, weeks, phases from training_cycles where tenant_id=$1 and active order by start_date desc limit 1",
      [tenantId],
    ),
    c.query(
      "select name, to_char(start_date,'YYYY-MM-DD') as start_date, to_char(end_date,'YYYY-MM-DD') as end_date, focus from phases where tenant_id=$1 order by start_date",
      [tenantId],
    ),
    c.query("select * from performance_indicators where tenant_id=$1 limit 1", [tenantId]),
    c.query(
      "select last_period_start, cycle_length, period_length, notes from menstrual_cycle where tenant_id=$1 limit 1",
      [tenantId],
    ),
  ]);

  // The Season the athlete actually sees: the `phases` TABLE wins (race-mode
  // athletes populate it, sometimes seeded directly); otherwise it's derived
  // from the active cycle — same precedence as the /app dashboard. Without this
  // a race athlete whose season lives in `phases` reads back as active_cycle:null
  // and the coach wrongly concludes "no season in the database".
  const activeCycle = cycle.rows[0] ?? null;
  // The active cycle wins — same precedence the dashboard draws with, so what a
  // coach reads here is what the athlete sees. `set_cycle` is the only way to
  // define a season; nothing writes the `phases` table, so rows there are legacy
  // seed data and must not override what the coach just programmed.
  const season = activeCycle
    ? { source: "cycle", phases: cycleToSeason(activeCycle.start_date, activeCycle.phases ?? []) }
    : phasesTable.rows.length > 0
      ? { source: "phases", phases: phasesTable.rows }
      : { source: "none", phases: [] };

  return {
    profile: profile.rows[0] ?? null,
    races: races.rows,
    active_cycle: activeCycle,
    season,
    indicators: indicators.rows[0] ?? null,
    menstrual_cycle: menstrual.rows[0] ?? null,
    configured: profile.rows.length > 0,
  };
}

export const workoutsRangeSchema = {
  from: z.string().describe("start date, YYYY-MM-DD"),
  to: z.string().describe("end date, YYYY-MM-DD"),
} satisfies z.ZodRawShape;

export async function readWorkouts(c: PoolClient, tenantId: string, from: string, to: string) {
  const { rows } = await c.query(
    `select date, discipline, title, status, key_workout, extra, adherence, muscle_groups,
            planned_duration_min, planned_tss, actual_duration_min, actual_tss, notes
       from workouts
      where tenant_id=$1 and date between $2 and $3
      order by date`,
    [tenantId, from, to],
  );
  return { from, to, count: rows.length, workouts: rows };
}

export const checkinsSchema = {
  days: z.number().int().min(1).max(90).default(14).describe("how many days back"),
} satisfies z.ZodRawShape;

export async function readCheckins(c: PoolClient, tenantId: string, days: number) {
  const { rows } = await c.query(
    `select date, readiness_score, hrv, sleep_hours, body_battery, resting_hr,
            recommendation, hydration_liters, notes
       from checkins
      where tenant_id=$1 and date >= current_date - $2::int
      order by date desc`,
    [tenantId, days],
  );
  return { days, count: rows.length, checkins: rows };
}

// The read halves of set_meal_plan / log_body_composition — without these a
// professional (or the athlete's own AI) can write nutrition and bioimpedance
// but never read them back, so it can't verify or edit without re-asking.

export async function readMealPlan(c: PoolClient, tenantId: string) {
  const [meals, fueling] = await Promise.all([
    c.query(
      `select meal_order, meal_name, time_suggestion, foods, protein_g, carbs_g, notes
         from daily_meal_plan where tenant_id=$1 order by meal_order`,
      [tenantId],
    ),
    c.query(
      `select duration_category, duration_range, discipline_context,
              before_training, during_training, after_training, supplements_used, notes
         from nutrition_plan where tenant_id=$1 order by duration_category`,
      [tenantId],
    ),
  ]);
  return {
    meals: meals.rows,
    fueling: fueling.rows,
    configured: meals.rows.length > 0 || fueling.rows.length > 0,
  };
}

export const bodyCompositionSchema = {
  limit: z.number().int().min(1).max(60).default(12).describe("how many recent readings, newest first"),
} satisfies z.ZodRawShape;

export async function readBodyComposition(c: PoolClient, tenantId: string, limit: number) {
  const { rows } = await c.query(
    `select date, weight_kg, muscle_mass_kg, body_fat_pct, lean_mass_kg,
            visceral_fat, metabolic_age, notes
       from body_composition where tenant_id=$1 order by date desc limit $2`,
    [tenantId, limit],
  );
  return { count: rows.length, readings: rows };
}
