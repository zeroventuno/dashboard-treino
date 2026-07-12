// Server-only: reads the NEW multi-tenant product project, scoped to one tenant.
// Additive — the live dashboard (lib/data.ts, app/page.tsx) is untouched.
import { createHash } from "node:crypto";
import { getMockData } from "./mock";
import { getProductSupabase } from "./supabase-product";
import { addDays, parseDate, toISO } from "./utils";
import type { DashboardData, TrainingLoad, Workout } from "./types";

/** account API key → tenant_id, via a security-definer RPC (app.tenants lives in
 * a private schema PostgREST can't read directly). Returns null if unknown. */
export async function resolveTenantId(accountKey: string): Promise<string | null> {
  const supabase = getProductSupabase();
  if (!supabase) return null;
  const keyHash = createHash("sha256").update(accountKey).digest("hex");
  const { data, error } = await supabase.rpc("resolve_tenant", { key_hash: keyHash });
  if (error || !data) return null;
  return typeof data === "string" ? data : null;
}

/** Continue the PMC from the last training_load row to today using workout TSS
 * (same logic as the personal dashboard; duplicated so lib/data.ts stays as-is). */
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
 * Loads one tenant's dashboard data from the product project. Every query is
 * scoped by tenant_id. Falls back to mock when the product backend isn't
 * configured yet, so /app always renders during development.
 */
export async function getProductDashboardData(
  tenantId: string,
): Promise<{ data: DashboardData; live: boolean }> {
  const supabase = getProductSupabase();
  if (!supabase) return { data: getMockData(), live: false };

  try {
    const t = (table: string, order: string, asc = true) =>
      supabase.from(table).select("*").eq("tenant_id", tenantId).order(order, { ascending: asc });

    const [tl, wk, ph, ms, ind, st, ck, inj, bc, mp, nr] = await Promise.all([
      t("training_load", "date"),
      t("workouts", "date"),
      t("phases", "start_date"),
      t("performance_milestones", "date"),
      t("performance_indicators", "updated_at", false).limit(1),
      t("strength_sessions", "date", false),
      t("checkins", "date"),
      t("injury_log", "date", false),
      t("body_composition", "date"),
      t("daily_meal_plan", "meal_order"),
      t("nutrition_plan", "duration_category"),
    ]);

    const anyError = [tl, wk, ph, ms, ind, st, ck, inj, bc, mp, nr].find((r) => r.error);
    if (anyError?.error) throw anyError.error;

    return {
      live: true,
      data: {
        trainingLoad: extendTrainingLoad(tl.data ?? [], wk.data ?? [], toISO(new Date())),
        workouts: wk.data ?? [],
        phases: ph.data ?? [],
        milestones: ms.data ?? [],
        indicators: ind.data?.[0] ?? null,
        strength: st.data ?? [],
        checkins: ck.data ?? [],
        injuries: inj.data ?? [],
        bodyComposition: bc.data ?? [],
        mealPlan: mp.data ?? [],
        nutritionRules: nr.data ?? [],
      },
    };
  } catch (err) {
    console.error("[product] Supabase read failed, using mock:", err);
    return { data: getMockData(), live: false };
  }
}
