// Server-only module: imported exclusively from server components / route handlers.
import { getMockData } from "./mock";
import { getSupabase } from "./supabase";
import type { DashboardData, WorkoutStatus } from "./types";

/**
 * Loads everything the dashboard needs. Queries Supabase when configured,
 * otherwise returns deterministic mock data. Any failure degrades gracefully
 * to mock so the page never hard-crashes on a cold/misconfigured backend.
 */
export async function getDashboardData(): Promise<{ data: DashboardData; live: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { data: getMockData(), live: false };

  try {
    const [tl, wk, ph, ms, ind, st, ck, inj] = await Promise.all([
      supabase.from("training_load").select("*").order("date", { ascending: true }),
      supabase.from("workouts").select("*").order("date", { ascending: true }),
      supabase.from("phases").select("*").order("start_date", { ascending: true }),
      supabase.from("performance_milestones").select("*").order("date", { ascending: true }),
      supabase.from("performance_indicators").select("*").order("updated_at", { ascending: false }).limit(1),
      supabase.from("strength_sessions").select("*").order("date", { ascending: false }),
      supabase.from("checkins").select("*").order("date", { ascending: true }),
      supabase.from("injury_log").select("*").order("date", { ascending: false }),
    ]);

    const anyError = [tl, wk, ph, ms, ind, st, ck, inj].find((r) => r.error);
    if (anyError?.error) throw anyError.error;

    return {
      live: true,
      data: {
        trainingLoad: tl.data ?? [],
        workouts: wk.data ?? [],
        phases: ph.data ?? [],
        milestones: ms.data ?? [],
        indicators: ind.data?.[0] ?? null,
        strength: st.data ?? [],
        checkins: ck.data ?? [],
        injuries: inj.data ?? [],
      },
    };
  } catch (err) {
    console.error("[dashboard] Supabase read failed, using mock:", err);
    return { data: getMockData(), live: false };
  }
}

/** Update a workout's status (+ optional actual TSS / notes). */
export async function setWorkoutStatus(
  id: string,
  status: WorkoutStatus,
  extra?: { actual_tss?: number | null; notes?: string | null },
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
