// Server-only module: imported exclusively from server components / route handlers.
import { getMockData } from "./mock";
import { getSupabase } from "./supabase";
import { addDays, parseDate, toISO } from "./utils";
import type { DashboardData, TrainingLoad, Workout, WorkoutStatus } from "./types";

/**
 * The training_load table (seeded from Strava) stops at its last synced date.
 * Rather than require a separate daily sync, we continue the PMC from that
 * last row up to *today* using the TSS of workouts logged since — so the
 * Fitness/Fatigue/Form chart advances automatically as the coach marks
 * workouts done. Uses the same 42d/7d EWMA as the historical rows.
 */
function extendTrainingLoad(load: TrainingLoad[], workouts: Workout[], todayISO: string): TrainingLoad[] {
  if (load.length === 0) return load;
  const sorted = [...load].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = sorted[sorted.length - 1];
  const today = parseDate(todayISO);
  let cursor = parseDate(last.date);
  if (cursor >= today || last.ctl == null || last.atl == null) return sorted;

  // total daily TSS from logged workouts (actual preferred, else planned)
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
    const tsb = ctl - atl; // TSB[t] = CTL[t-1] - ATL[t-1]
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    out.push({ date: iso, tss, ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +tsb.toFixed(1), source: "manual" });
  }
  return out;
}

/**
 * Loads everything the dashboard needs. Queries Supabase when configured,
 * otherwise returns deterministic mock data. Any failure degrades gracefully
 * to mock so the page never hard-crashes on a cold/misconfigured backend.
 */
export async function getDashboardData(): Promise<{ data: DashboardData; live: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { data: getMockData(), live: false };

  try {
    const [tl, wk, ph, ms, ind, st, ck, inj, bc, mp, nr] = await Promise.all([
      supabase.from("training_load").select("*").order("date", { ascending: true }),
      supabase.from("workouts").select("*").order("date", { ascending: true }),
      supabase.from("phases").select("*").order("start_date", { ascending: true }),
      supabase.from("performance_milestones").select("*").order("date", { ascending: true }),
      supabase.from("performance_indicators").select("*").order("updated_at", { ascending: false }).limit(1),
      supabase.from("strength_sessions").select("*").order("date", { ascending: false }),
      supabase.from("checkins").select("*").order("date", { ascending: true }),
      supabase.from("injury_log").select("*").order("date", { ascending: false }),
      supabase.from("body_composition").select("*").order("date", { ascending: true }),
      supabase.from("daily_meal_plan").select("*").order("meal_order", { ascending: true }),
      supabase.from("nutrition_plan").select("*").order("duration_category", { ascending: true }),
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
    console.error("[dashboard] Supabase read failed, using mock:", err);
    return { data: getMockData(), live: false };
  }
}

/** Update a workout's status (+ optional actual duration/distance/TSS/notes). */
export async function setWorkoutStatus(
  id: string,
  status: WorkoutStatus,
  extra?: {
    actual_tss?: number | null;
    actual_duration_min?: number | null;
    actual_distance_km?: number | null;
    notes?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Backend não configurado (dados mock)." };

  const { error } = await supabase
    .from("workouts")
    .update({ status, ...extra })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
