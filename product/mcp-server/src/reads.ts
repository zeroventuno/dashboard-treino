import { z } from "zod";
import type { PoolClient } from "pg";

// ────────────────────────────────────────────────────────────────────────────
//  Shared read cores — same SELECTs feed the athlete's own key (tools.ts) and a
//  professional reading a roster athlete (staff-tools.ts). Each takes a client
//  already inside a withTenant transaction (so RLS scopes to that tenant) and
//  returns the plain object the tool serializes.
// ────────────────────────────────────────────────────────────────────────────

export async function readProfile(c: PoolClient, tenantId: string) {
  const [profile, races, cycle, indicators, menstrual] = await Promise.all([
    c.query(
      "select athlete, devices, metrics, mode, locale, units, anatomy, updated_at from profiles where tenant_id=$1 limit 1",
      [tenantId],
    ),
    c.query("select name, date, priority from races where tenant_id=$1 order by date", [tenantId]),
    c.query(
      "select name, start_date, weeks, phases from training_cycles where tenant_id=$1 and active order by start_date desc limit 1",
      [tenantId],
    ),
    c.query("select * from performance_indicators where tenant_id=$1 limit 1", [tenantId]),
    c.query(
      "select last_period_start, cycle_length, period_length, notes from menstrual_cycle where tenant_id=$1 limit 1",
      [tenantId],
    ),
  ]);
  return {
    profile: profile.rows[0] ?? null,
    races: races.rows,
    active_cycle: cycle.rows[0] ?? null,
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
