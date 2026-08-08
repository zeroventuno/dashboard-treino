// Server-only: reads the NEW multi-tenant product project, scoped to one tenant.
// Additive — the live dashboard (lib/data.ts, app/page.tsx) is untouched.
//
// Isolation is enforced TWICE: the connection runs as app_writer with
// app.tenant_id set (so RLS refuses other tenants' rows at the database level),
// AND every query still carries an explicit tenant_id filter. Either alone would
// do; together, a mistake in one can't leak data.
import { getMockData } from "./mock";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./i18n";
import { hasProductDb, withTenant } from "./product-db";
import { addDays, parseDate, toISO } from "./utils";
import { RACE_DATE, RACE_NAME } from "./types";
import type { Availability } from "./availability";
import type {
  BodyComposition, Checkin, DailyMeal, DashboardData, InjuryEntry, MenstrualCycle, NutritionRule,
  PerformanceIndicators, PerformanceMilestone, Phase, StrengthSession, TrainingLoad, Workout,
} from "./types";

import type { Metric } from "./tenant-config";

export { resolveTenantId } from "./product-db";

/** The athlete's own configuration — what they're training for and which blocks
 * apply to them. Separate from DashboardData (the training rows) because it
 * answers "what should this dashboard look like", not "what happened". */
export interface TenantView {
  athlete: string | null;
  metrics: Metric[];
  mode: "race" | "cycle";
  raceName: string | null;
  raceISO: string | null;
  /** Every target race. The coach writes A/B/C with set_races, and showing only
   * the primary meant the B and C races went nowhere. */
  races: { name: string; date: string; priority: string }[];
  cycleName: string | null;
  /** Body figure for the strength map. */
  anatomy: "male" | "female";
  /** What a training week has to fit around — the athlete fills this in on
   * their own dashboard, and their AI (B2C) or their coach (B2B) reads it. */
  preferences: Availability;
  /** Distance/weight display; anything but "imperial" renders metric. */
  units: "metric" | "imperial";
  /** Full cycle, for the hero's week-of-N progress and the season timeline.
   * Null when the athlete is training toward a race instead. */
  cycle: { name: string; startISO: string; weeks: number; phases: CyclePhase[] } | null;
}

export interface CyclePhase {
  name: string;
  weeks: number;
  focus: string | null;
}

/** A cycle's phases live inside training_cycles.phases (jsonb); the Season block
 * reads the `phases` TABLE, which only race-mode athletes populate. Without this
 * translation an athlete on a cycle gets an empty Season block forever — /demo
 * has always done it, /app never did. */
function cycleToPhases(cycle: NonNullable<TenantView["cycle"]>): Phase[] {
  const colors = ["#2dd4bf", "#c6f24e", "#f4a24e", "#4fb8ff"];
  let cursor = parseDate(cycle.startISO);
  return cycle.phases.map((ph, i) => {
    const start = cursor;
    const end = addDays(start, ph.weeks * 7 - 1);
    cursor = addDays(end, 1);
    return {
      id: `cycle-${i}`,
      name: ph.name,
      start_date: toISO(start),
      end_date: toISO(end),
      focus: ph.focus,
      color: colors[i % colors.length],
    };
  });
}

/** Used only on the mock/fallback paths. Carries the sample data's own metrics
 * so the fallback renders a complete dashboard rather than an onboarding screen
 * — the fallback exists to prove the UI works, not to look like a new account. */
const MOCK_TENANT: TenantView = {
  athlete: null,
  metrics: [
    "hrv", "body_battery", "sleep", "readiness", "power", "zones",
    "bioimpedance", "nutrition", "strength", "hydration", "protein",
  ],
  mode: "race",
  raceName: RACE_NAME,
  raceISO: RACE_DATE,
  races: [{ name: RACE_NAME, date: RACE_DATE, priority: "A" }],
  cycleName: null,
  cycle: null,
  anatomy: "male",
  preferences: {},
  units: "metric",
};

/** A tenant the coach has never configured: no metrics declared and nothing
 * logged. Rendering the full dashboard here means eight empty blocks, so the
 * caller shows onboarding instead. */
export function isUnconfigured(tenant: TenantView, data: DashboardData): boolean {
  return (
    tenant.metrics.length === 0 &&
    data.workouts.length === 0 &&
    data.checkins.length === 0 &&
    !tenant.raceName &&
    !tenant.cycleName
  );
}

/** Continue the PMC from the last training_load row to today using workout TSS
 * (same logic as the personal dashboard; kept here so lib/data.ts stays as-is). */
function extendTrainingLoad(load: TrainingLoad[], workouts: Workout[], todayISO: string): TrainingLoad[] {
  const sorted = [...load].sort((a, b) => (a.date < b.date ? -1 : 1));
  const today = parseDate(todayISO);

  let cursor: Date;
  let ctl: number;
  let atl: number;
  let out: TrainingLoad[];

  if (sorted.length === 0) {
    // No history to continue from. This used to return empty, which meant the
    // fitness chart stayed blank forever for every new athlete: training_load
    // is only ever populated by the migration, and no coach tool writes it. So
    // build the curve from the sessions themselves, starting at zero — which is
    // exactly what a real PMC looks like for someone just starting out.
    if (workouts.length === 0) return [];
    const firstISO = workouts.reduce((min, w) => (w.date < min ? w.date : min), workouts[0].date);
    // Step back a day so the loop's first iteration lands ON the first session.
    cursor = addDays(parseDate(firstISO), -1);
    ctl = 0;
    atl = 0;
    out = [];
  } else {
    const last = sorted[sorted.length - 1];
    if (last.ctl == null || last.atl == null) return sorted;
    cursor = parseDate(last.date);
    ctl = last.ctl;
    atl = last.atl;
    out = [...sorted];
  }

  if (cursor >= today) return out.length > 0 ? out : sorted;

  const tssByDate: Record<string, number> = {};
  for (const w of workouts) {
    const t = Number(w.actual_tss ?? w.planned_tss ?? 0);
    if (t > 0) tssByDate[w.date] = (tssByDate[w.date] ?? 0) + t;
  }

  while (cursor < today) {
    cursor = addDays(cursor, 1);
    const iso = toISO(cursor);
    const tss = Math.round(tssByDate[iso] ?? 0);
    const tsb = ctl - atl;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    out.push({ date: iso, tss, ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +tsb.toFixed(1), source: "manual" });
  }
  return out;
}

/**
 * Loads one tenant's dashboard data from the product project. Falls back to mock
 * when PRODUCT_DATABASE_URL isn't set, so /app always renders.
 */
export async function getProductDashboardData(
  tenantId: string,
): Promise<{ data: DashboardData; live: boolean; locale: Locale; tenant: TenantView; error?: string }> {
  if (!hasProductDb() || !tenantId) {
    return { data: getMockData(), live: false, locale: DEFAULT_LOCALE, tenant: MOCK_TENANT };
  }

  try {
    const result = await withTenant(tenantId, async (c) => {
      const q = async <T>(sql: string): Promise<T[]> => {
        const { rows } = await c.query(sql, [tenantId]);
        return rows as T[];
      };

      // The athlete's own config, set by the coach via set_profile. `metrics`
      // decides which blocks exist for them at all — without it the dashboard
      // would show every block to everyone, including ones they can't feed.
      const profile = await q<{
        locale: string | null;
        metrics: string[] | null;
        mode: string | null;
        athlete: string | null;
        anatomy: string | null;
        units: string | null;
        preferences: Availability | null;
      }>("select locale, metrics, mode, athlete, anatomy, units, preferences from profiles where tenant_id=$1 limit 1");
      const locale = isLocale(profile[0]?.locale) ? profile[0].locale : DEFAULT_LOCALE;

      // Next A race, else the soonest upcoming, else the most recent past one.
      const races = await q<{ name: string; date: string; priority: string }>(
        `select name, date, priority from races where tenant_id=$1
           order by (priority = 'A' and date >= current_date) desc,
                    (date >= current_date) desc,
                    case when date >= current_date then date end asc nulls last,
                    date desc`,
      );
      const cycles = await q<{ name: string; start_date: string; weeks: number; phases: CyclePhase[] | null }>(
        "select name, start_date, weeks, phases from training_cycles where tenant_id=$1 and active order by start_date desc limit 1",
      );
      const cycle = cycles[0]
        ? {
            name: cycles[0].name,
            startISO: cycles[0].start_date,
            weeks: Number(cycles[0].weeks),
            phases: cycles[0].phases ?? [],
          }
        : null;

      const tenant: TenantView = {
        athlete: profile[0]?.athlete ?? null,
        metrics: (profile[0]?.metrics ?? []) as Metric[],
        preferences: profile[0]?.preferences ?? {},
        mode: profile[0]?.mode === "cycle" ? "cycle" : "race",
        races,
        raceName: races[0]?.name ?? null,
        raceISO: races[0]?.date ?? null,
        cycleName: cycle?.name ?? null,
        cycle,
        anatomy: profile[0]?.anatomy === "female" ? "female" : "male",
        units: profile[0]?.units === "imperial" ? "imperial" : "metric",
      };

      const trainingLoad = await q<TrainingLoad>(
        "select date, tss, ctl, atl, tsb, source from training_load where tenant_id=$1 order by date",
      );
      const workouts = await q<Workout>("select * from workouts where tenant_id=$1 order by date");
      const phases = await q<Phase>("select * from phases where tenant_id=$1 order by start_date");
      const milestoneRows = await q<PerformanceMilestone>(
        "select * from performance_milestones where tenant_id=$1 order by date",
      );
      // The Season block draws its bottom markers from `milestones`, but no
      // coach tool writes performance_milestones — it's empty on every real
      // account (the /demo shows entries only because they're in mock data).
      // Meanwhile the athlete's races DO get written, via set_races, and only
      // ever surfaced in the hero. So a race the coach added showed up top but
      // not on the season timeline. Fold the races in as markers, using the
      // priority letter as the label, so they land where they belong.
      const raceMarkers: PerformanceMilestone[] = races.map((r, i) => ({
        id: `race-${i}`,
        date: r.date,
        metric: r.priority === "A" ? "Race" : `Race ${r.priority}`,
        value: null,
        unit: null,
        notes: r.name,
      }));
      const milestones = [...milestoneRows, ...raceMarkers];
      const indicators = await q<PerformanceIndicators>(
        "select * from performance_indicators where tenant_id=$1 limit 1",
      );
      // The body heatmap reads `strength`, but strength_sessions was never
      // written by any coach tool — a strength workout logged via upsert_workout
      // went to `workouts`, not here. Derive the sessions from those workouts so
      // one write feeds both the calendar and the map. (strength_sessions stays
      // for the personal dashboard, which has its own migrated data.)
      const strengthRows = await q<{ id: string; date: string; title: string; muscle_groups: string[] | null; notes: string | null }>(
        `select id, date, title, muscle_groups, notes from workouts
           where tenant_id=$1 and discipline='strength' and coalesce(array_length(muscle_groups,1),0) > 0
           order by date desc`,
      );
      const strength: StrengthSession[] = strengthRows.map((w) => ({
        id: w.id,
        date: w.date,
        muscle_groups: (w.muscle_groups ?? []) as StrengthSession["muscle_groups"],
        exercises: null,
        notes: w.notes,
      }));
      const checkins = await q<Checkin>("select * from checkins where tenant_id=$1 order by date");
      const injuries = await q<InjuryEntry>(
        "select * from injury_log where tenant_id=$1 order by date desc",
      );
      const bodyComposition = await q<BodyComposition>(
        "select * from body_composition where tenant_id=$1 order by date",
      );
      const mealPlan = await q<DailyMeal>(
        "select * from daily_meal_plan where tenant_id=$1 order by meal_order",
      );
      const nutritionRules = await q<NutritionRule>(
        "select * from nutrition_plan where tenant_id=$1 order by duration_category",
      );
      // Opt-in, one row per athlete. Null when never set — the block shows an
      // empty state, and it's gated behind the "menstrual" metric anyway.
      const menstrualRows = await q<MenstrualCycle>(
        "select last_period_start, cycle_length, period_length, notes from menstrual_cycle where tenant_id=$1 limit 1",
      );

      const data: DashboardData = {
        trainingLoad: extendTrainingLoad(trainingLoad, workouts, toISO(new Date())),
        workouts,
        // An athlete on a cycle has no rows in `phases` — their phases live
        // inside the cycle. Derive them, or the Season block stays empty.
        phases: phases.length > 0 ? phases : cycle ? cycleToPhases(cycle) : [],
        milestones,
        indicators: indicators[0] ?? null,
        strength,
        checkins,
        injuries,
        bodyComposition,
        mealPlan,
        nutritionRules,
        menstrualCycle: menstrualRows[0] ?? null,
      };
      return { data, locale, tenant };
    });

    return { live: true, ...result };
  } catch (err) {
    // Falling back to mock is right — a broken read shouldn't blank the page.
    // Staying SILENT about why was not: a failed query and "no data yet" drew
    // the identical screen, so a missing migration read as "my data is gone".
    // The message travels to the UI; console.error is invisible to whoever is
    // actually looking at the dashboard.
    console.error("[product] read failed, using mock:", err);
    const e = err as { message?: string; code?: string };
    const detail = [e.code, e.message].filter(Boolean).join(" · ").slice(0, 200);
    return {
      data: getMockData(), live: false, locale: DEFAULT_LOCALE, tenant: MOCK_TENANT,
      error: detail || "unknown",
    };
  }
}

/**
 * What this athlete is training FOR — their next A race, or the name of their
 * current cycle if they aren't racing. Used for the browser tab title.
 *
 * Deliberately its own small query rather than reusing getProductDashboardData:
 * Next runs generateMetadata alongside the page render, so sharing that function
 * would mean loading every training table twice to print one string.
 *
 * Returns null when there's nothing to name (no DB, no tenant, or a fresh
 * account) so the caller can fall back to the plain brand title.
 */
export async function getDashboardSubject(tenantId: string): Promise<string | null> {
  if (!hasProductDb() || !tenantId) return null;

  try {
    return await withTenant(tenantId, async (c) => {
      const mode = (
        await c.query("select mode from profiles where tenant_id=$1 limit 1", [tenantId])
      ).rows[0]?.mode;

      if (mode !== "cycle") {
        // Next A race that hasn't happened yet; falls back to any upcoming race,
        // then to the most recent past one (just finished a season → still the
        // thing the dashboard is about).
        const { rows } = await c.query(
          `select name from races where tenant_id=$1
             order by (priority = 'A' and date >= current_date) desc,
                      (date >= current_date) desc,
                      case when date >= current_date then date end asc nulls last,
                      date desc
             limit 1`,
          [tenantId],
        );
        if (rows[0]?.name) return rows[0].name as string;
      }

      const { rows } = await c.query(
        "select name from training_cycles where tenant_id=$1 and active order by start_date desc limit 1",
        [tenantId],
      );
      return (rows[0]?.name as string) ?? null;
    });
  } catch (err) {
    console.error("[product] title lookup failed:", err);
    return null;
  }
}
