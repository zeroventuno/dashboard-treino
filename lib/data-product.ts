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
import type {
  BodyComposition, Checkin, DailyMeal, DashboardData, InjuryEntry, NutritionRule,
  PerformanceIndicators, PerformanceMilestone, Phase, StrengthSession, TrainingLoad, Workout,
} from "./types";

export { resolveTenantId } from "./product-db";

/** Continue the PMC from the last training_load row to today using workout TSS
 * (same logic as the personal dashboard; kept here so lib/data.ts stays as-is). */
function extendTrainingLoad(load: TrainingLoad[], workouts: Workout[], todayISO: string): TrainingLoad[] {
  if (load.length === 0) return load;
  const sorted = [...load].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = sorted[sorted.length - 1];
  const today = parseDate(todayISO);
  let cursor = parseDate(last.date);
  if (cursor >= today || last.ctl == null || last.atl == null) return sorted;

  const tssByDate: Record<string, number> = {};
  for (const w of workouts) {
    const t = Number(w.actual_tss ?? w.planned_tss ?? 0);
    if (t > 0) tssByDate[w.date] = (tssByDate[w.date] ?? 0) + t;
  }

  let ctl = last.ctl;
  let atl = last.atl;
  const out = [...sorted];
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
): Promise<{ data: DashboardData; live: boolean; locale: Locale }> {
  if (!hasProductDb() || !tenantId) {
    return { data: getMockData(), live: false, locale: DEFAULT_LOCALE };
  }

  try {
    const result = await withTenant(tenantId, async (c) => {
      const q = async <T>(sql: string): Promise<T[]> => {
        const { rows } = await c.query(sql, [tenantId]);
        return rows as T[];
      };

      // the athlete's UI language, set by the coach via set_profile
      const profile = await q<{ locale: string | null }>(
        "select locale from profiles where tenant_id=$1 limit 1",
      );
      const locale = isLocale(profile[0]?.locale) ? profile[0].locale : DEFAULT_LOCALE;

      const trainingLoad = await q<TrainingLoad>(
        "select date, tss, ctl, atl, tsb, source from training_load where tenant_id=$1 order by date",
      );
      const workouts = await q<Workout>("select * from workouts where tenant_id=$1 order by date");
      const phases = await q<Phase>("select * from phases where tenant_id=$1 order by start_date");
      const milestones = await q<PerformanceMilestone>(
        "select * from performance_milestones where tenant_id=$1 order by date",
      );
      const indicators = await q<PerformanceIndicators>(
        "select * from performance_indicators where tenant_id=$1 limit 1",
      );
      const strength = await q<StrengthSession>(
        "select * from strength_sessions where tenant_id=$1 order by date desc",
      );
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

      const data: DashboardData = {
        trainingLoad: extendTrainingLoad(trainingLoad, workouts, toISO(new Date())),
        workouts,
        phases,
        milestones,
        indicators: indicators[0] ?? null,
        strength,
        checkins,
        injuries,
        bodyComposition,
        mealPlan,
        nutritionRules,
      };
      return { data, locale };
    });

    return { live: true, ...result };
  } catch (err) {
    console.error("[product] read failed, using mock:", err);
    return { data: getMockData(), live: false, locale: DEFAULT_LOCALE };
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
