import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "./db.js";

// ────────────────────────────────────────────────────────────────────────────
//  Shared write cores.
//
//  The exact same SQL feeds two front doors: the athlete's own key (tools.ts,
//  bound to one tenant) and a professional's key (staff-tools.ts, acting across
//  a roster). Extracting the schema + the write here keeps them from drifting —
//  a fix to how a workout is stored lands in both at once. Each `run*` takes a
//  client already inside a withTenant transaction (so app.tenant_id / RLS are
//  set) and returns the human-readable confirmation line.
// ────────────────────────────────────────────────────────────────────────────

/** Resolve an athlete named by a professional to a tenant_id — but ONLY within
 * that professional's roster. This is the B2B authorization boundary: a staff
 * member can never touch an athlete that wasn't assigned to them. Matches on the
 * display name (case-insensitive), the email, or the raw id. Reads the private
 * `app` schema, so no per-tenant RLS context is needed to find who they mean. */
export async function resolveRosterAthlete(
  staffId: string,
  athlete: string,
): Promise<{ tenantId: string; name: string } | null> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `select t.id, coalesce(t.athlete_name, t.email) as name
       from app.staff_athletes sa
       join app.tenants t on t.id = sa.tenant_id
      where sa.staff_id = $1
        and (lower(coalesce(t.athlete_name,'')) = lower($2) or t.email = $2 or t.id::text = $2)
      limit 1`,
    [staffId, athlete],
  );
  const r = rows[0];
  return r ? { tenantId: r.id, name: r.name } : null;
}

// ── upsert_workout (coach) ──────────────────────────────────────────────────

export const workoutSchema = {
  date: z.string(),
  discipline: z
    .enum(["swim", "bike", "run", "strength", "rest", "other"])
    .describe(
      "one of: swim, bike, run, strength, rest, other — never a translated or free-form name. " +
      "USE \"other\" for any sport the plan does not model: a hike, a ski tour, a row, a football " +
      "match. Put the real activity in the title ('Pontechianale Hiking'), and set extra: true so it " +
      "counts in the week's volume without pretending to be a prescribed session. Do NOT file these " +
      "under 'rest' — that means a DAY OFF, and five hours of walking recorded as rest makes the " +
      "calendar claim the athlete rested on a day they did not.",
    ),
  title: z.string(),
  status: z
    .enum(["planned", "done", "skipped", "cancelled", "moved"])
    .default("planned")
    .describe(
      "planned = to do · done = completed (adherence says how well) · skipped = athlete no-showed · " +
      "cancelled = you removed it · moved = rescheduled (leave this one and add a copy on the new date). " +
      "cancelled & moved drop out of the week's totals; skipped stays as a miss.",
    ),
  extra: z
    .boolean()
    .optional()
    .describe("true = an unscheduled session the athlete added — counts in the week's volume, not in the plan's x/y."),
  adherence: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "0-100 quality score for a DONE workout — how well it matched the plan (your judgment: an athlete who " +
      "swapped it for something unrelated scores low even if the duration matched). Omit and the dashboard " +
      "estimates it from actual vs planned duration/TSS/distance.",
    ),
  description: z.string().optional(),
  garmin_instructions: z.string().optional(),
  zwo_content: z.string().optional(),
  planned_duration_min: z.number().optional(),
  actual_duration_min: z.number().optional(),
  planned_distance_km: z.number().optional(),
  actual_distance_km: z.number().optional(),
  planned_tss: z.number().optional(),
  actual_tss: z.number().optional(),
  planned_pace: z.string().optional(),
  actual_pace: z.string().optional(),
  planned_power_watts: z.string().optional(),
  actual_power_watts: z.string().optional(),
  actual_rpe: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe(
      "How hard the session actually FELT, 0-10 (Borg CR10). Ask for it whenever the athlete tells you how a " +
      "session went — and always for an athlete with no power meter, no HR strap and no GPS, because for them " +
      "this is the only measurement that exists and their adherence score depends on it. Per session, not per " +
      "day: a morning swim and an evening ride are two different efforts.",
    ),
  notes: z.string().optional(),
  nutrition_notes: z.string().optional(),
  key_workout: z.boolean().optional(),
  structure: z
    .array(
      z.object({
        label: z.string(),
        duration_min: z.number(),
        intensity: z.number().optional(),
        target: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  activation: z.string().optional(),
  nutrition_pre: z.string().optional(),
  mobility: z.string().optional(),
  nutrition_post: z.string().optional(),
  muscle_groups: z
    .array(
      z.enum([
        "quadriceps", "glutes", "hamstrings", "core", "shoulders",
        "back", "calves", "chest", "biceps", "triceps",
      ]),
    )
    .optional()
    .describe("strength only; fixed English slugs, e.g. [\"quadriceps\",\"glutes\",\"core\"]"),
} satisfies z.ZodRawShape;

export type WorkoutArgs = z.infer<z.ZodObject<typeof workoutSchema>>;

// ── delete_workout ──────────────────────────────────────────────────────────

export const deleteWorkoutSchema = {
  date: z.string().describe("YYYY-MM-DD of the session to remove"),
  discipline: z
    .enum(["swim", "bike", "run", "strength", "rest", "other"])
    .describe("must match the stored discipline exactly"),
  title: z
    .string()
    .optional()
    .describe(
      "Exact title. Omit ONLY when the athlete means every session of that " +
      "discipline on that day — with several, omitting it removes them all.",
    ),
} satisfies z.ZodRawShape;

export type DeleteWorkoutArgs = z.infer<z.ZodObject<typeof deleteWorkoutSchema>>;

/**
 * Remove a session outright.
 *
 * Distinct from status "cancelled", and both are needed. Cancelled is a session
 * that WAS planned and then called off — it happened as a decision, it drops out
 * of the week's totals, and the struck-through row is the record of that
 * decision. This is for a row that should never have existed: a mis-typed
 * discipline, a duplicate, an activity logged by hand that the watch then
 * imported properly. Leaving those as cancelled leaves permanent litter on the
 * calendar describing a choice nobody made.
 *
 * Rows the device wrote are protected: `external_id is null` means only
 * hand-entered sessions can be deleted here, so a mistaken cleanup can never
 * erase imported history that the next sync would then quietly restore.
 */
export async function runDeleteWorkout(
  c: PoolClient,
  tenantId: string,
  a: DeleteWorkoutArgs,
): Promise<string> {
  const { rows } = await c.query<{ title: string }>(
    `delete from workouts
      where tenant_id = $1 and date = $2::date and discipline = $3
        and external_id is null
        and ($4::text is null or title = $4)
      returning title`,
    [tenantId, a.date, a.discipline, a.title ?? null],
  );

  if (rows.length === 0) {
    return (
      `Nothing deleted: no hand-entered ${a.discipline} on ${a.date}` +
      (a.title ? ` titled "${a.title}"` : "") +
      `. Sessions imported from a device can't be removed this way — check the exact title with get_workouts.`
    );
  }
  return `Deleted ${rows.length} session(s) on ${a.date}: ${rows.map((r) => r.title).join(", ")}.`;
}

export async function runWorkout(c: PoolClient, tenantId: string, a: WorkoutArgs): Promise<string> {
  const { rows } = await c.query(
    `insert into workouts (tenant_id,date,discipline,title,status,description,garmin_instructions,zwo_content,
       planned_duration_min,actual_duration_min,planned_distance_km,actual_distance_km,planned_tss,actual_tss,
       planned_pace,actual_pace,planned_power_watts,actual_power_watts,notes,nutrition_notes,
       key_workout,structure,activation,nutrition_pre,mobility,nutrition_post,muscle_groups,extra,adherence)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       coalesce($21,false),$22::jsonb,$23,$24,$25,$26,coalesce($27::text[],'{}'::text[]),coalesce($28,false),$29)
     on conflict (tenant_id,date,discipline,title) do update set
       status=excluded.status,
       description=coalesce(excluded.description,workouts.description),
       garmin_instructions=coalesce(excluded.garmin_instructions,workouts.garmin_instructions),
       zwo_content=coalesce(excluded.zwo_content,workouts.zwo_content),
       planned_duration_min=coalesce(excluded.planned_duration_min,workouts.planned_duration_min),
       actual_duration_min=coalesce(excluded.actual_duration_min,workouts.actual_duration_min),
       planned_distance_km=coalesce(excluded.planned_distance_km,workouts.planned_distance_km),
       actual_distance_km=coalesce(excluded.actual_distance_km,workouts.actual_distance_km),
       planned_tss=coalesce(excluded.planned_tss,workouts.planned_tss),
       actual_tss=coalesce(excluded.actual_tss,workouts.actual_tss),
       planned_pace=coalesce(excluded.planned_pace,workouts.planned_pace),
       actual_pace=coalesce(excluded.actual_pace,workouts.actual_pace),
       planned_power_watts=coalesce(excluded.planned_power_watts,workouts.planned_power_watts),
       actual_power_watts=coalesce(excluded.actual_power_watts,workouts.actual_power_watts),
       notes=coalesce(excluded.notes,workouts.notes),
       nutrition_notes=coalesce(excluded.nutrition_notes,workouts.nutrition_notes),
       key_workout=coalesce($21,workouts.key_workout),
       structure=coalesce(excluded.structure,workouts.structure),
       activation=coalesce(excluded.activation,workouts.activation),
       nutrition_pre=coalesce(excluded.nutrition_pre,workouts.nutrition_pre),
       mobility=coalesce(excluded.mobility,workouts.mobility),
       nutrition_post=coalesce(excluded.nutrition_post,workouts.nutrition_post),
       muscle_groups=coalesce($27::text[],workouts.muscle_groups),
       extra=coalesce($28,workouts.extra),
       adherence=coalesce($29,workouts.adherence)
     returning date, discipline, title, status, planned_duration_min, planned_tss,
       key_workout, extra, adherence, zwo_content is not null as has_zwo,
       case when jsonb_typeof(structure) = 'array' then jsonb_array_length(structure) else 0 end as blocks`,
    [
      tenantId, a.date, a.discipline, a.title, a.status, a.description ?? null, a.garmin_instructions ?? null,
      a.zwo_content ?? null, a.planned_duration_min ?? null, a.actual_duration_min ?? null,
      a.planned_distance_km ?? null, a.actual_distance_km ?? null, a.planned_tss ?? null, a.actual_tss ?? null,
      a.planned_pace ?? null, a.actual_pace ?? null, a.planned_power_watts ?? null, a.actual_power_watts ?? null,
      a.notes ?? null, a.nutrition_notes ?? null,
      a.key_workout ?? null, a.structure ? JSON.stringify(a.structure) : null,
      a.activation ?? null, a.nutrition_pre ?? null, a.mobility ?? null, a.nutrition_post ?? null,
      a.muscle_groups ?? null, a.extra ?? null, a.adherence ?? null,
    ],
  );
  // Report the row as it now stands, not the arguments we sent. A field the
  // tool didn't recognise is dropped silently, so "saved." can be true and
  // still hide a workout that lost its blocks or its planned duration.
  const r = rows[0];
  if (!r) return `Workout "${a.title}" (${a.date}) → ${a.status}.`;
  const parts = [
    `status=${r.status}`,
    r.planned_duration_min != null ? `planned_duration_min=${r.planned_duration_min}` : null,
    r.planned_tss != null ? `planned_tss=${r.planned_tss}` : null,
    `structure=${r.blocks} block(s)`,
    r.key_workout ? "key_workout=true" : null,
    r.extra ? "extra=true" : null,
    r.adherence != null ? `adherence=${r.adherence}` : null,
  ].filter(Boolean);

  // The blocks are what draw the profile chart and the block list — and for a
  // bike session they're also what the dashboard turns into the .zwo download.
  const missingStructure =
    Number(r.blocks) === 0 && r.discipline !== "rest"
      ? ` No structure on this one: send the blocks (label + duration_min + intensity) or it's just a title${
          r.discipline === "bike" && !r.has_zwo ? ", and the athlete gets no Zwift file" : ""
        }.`
      : "";

  return `Workout "${r.title}" (${r.date}, ${r.discipline}) saved — stored: ${parts.join(", ")}.${missingStructure}`;
}

// ── set_meal_plan (nutritionist) ────────────────────────────────────────────

export const mealPlanSchema = {
  meals: z
    .array(
      z.object({
        meal_name: z.string().describe("e.g. Breakfast, Pre-ride snack, Recovery shake"),
        time_suggestion: z.string().optional().describe("HH:MM, or a phrase like 'on waking'"),
        foods: z.string().optional().describe("the foods; separate items with newlines"),
        protein_g: z.number().optional().describe("grams of protein for this meal"),
        carbs_g: z.number().optional().describe("grams of carbs for this meal"),
        notes: z.string().optional(),
      }),
    )
    .optional()
    .describe("daily meals, in eating order; omit to keep, [] to clear"),
  fueling: z
    .array(
      z.object({
        duration_category: z
          .enum(["curto", "medio", "longo", "muito_longo"])
          .describe("session-length bucket — use exactly these slugs"),
        duration_range: z.string().optional().describe("e.g. '< 1h', '1–3h', '> 3h'"),
        discipline_context: z.string().optional().describe("e.g. 'bike/run', 'long swim'"),
        before_training: z.string().optional(),
        during_training: z.string().optional(),
        after_training: z.string().optional(),
        supplements_used: z.array(z.string()).optional().describe("e.g. ['gel','caffeine']"),
        notes: z.string().optional(),
      }),
    )
    .optional()
    .describe("fueling rules by training duration; omit to keep, [] to clear"),
} satisfies z.ZodRawShape;

export type MealPlanArgs = z.infer<z.ZodObject<typeof mealPlanSchema>>;

export async function runMealPlan(c: PoolClient, tenantId: string, a: MealPlanArgs): Promise<string> {
  let mealsN = -1;
  let fuelN = -1;
  if (a.meals !== undefined) {
    await c.query("delete from daily_meal_plan where tenant_id=$1", [tenantId]);
    for (let i = 0; i < a.meals.length; i++) {
      const m = a.meals[i];
      await c.query(
        `insert into daily_meal_plan
           (tenant_id, meal_order, meal_name, time_suggestion, foods, protein_g, carbs_g, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          tenantId, i + 1, m.meal_name, m.time_suggestion ?? null, m.foods ?? null,
          m.protein_g ?? null, m.carbs_g ?? null, m.notes ?? null,
        ],
      );
    }
    mealsN = a.meals.length;
  }
  if (a.fueling !== undefined) {
    await c.query("delete from nutrition_plan where tenant_id=$1", [tenantId]);
    for (const r of a.fueling) {
      await c.query(
        `insert into nutrition_plan
           (tenant_id, duration_category, duration_range, discipline_context,
            before_training, during_training, after_training, supplements_used, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9)`,
        [
          tenantId, r.duration_category, r.duration_range ?? null, r.discipline_context ?? null,
          r.before_training ?? null, r.during_training ?? null, r.after_training ?? null,
          r.supplements_used ?? null, r.notes ?? null,
        ],
      );
    }
    fuelN = a.fueling.length;
  }
  const parts = [
    mealsN >= 0 && `${mealsN} meal(s)`,
    fuelN >= 0 && `${fuelN} fueling rule(s)`,
  ].filter(Boolean);
  return parts.length > 0
    ? `Meal plan saved — ${parts.join(", ")}.`
    : "Nothing to change — pass `meals` and/or `fueling`.";
}

// ── log_injury (physio) ─────────────────────────────────────────────────────

export const injurySchema = {
  date: z.string().describe("YYYY-MM-DD"),
  area: z.string().describe("body area, e.g. 'left knee', 'lower back'"),
  severity: z.number().int().min(1).max(5).optional().describe("1 mild … 5 severe"),
  notes: z.string().optional(),
} satisfies z.ZodRawShape;

export type InjuryArgs = z.infer<z.ZodObject<typeof injurySchema>>;

export async function runInjury(c: PoolClient, tenantId: string, a: InjuryArgs): Promise<string> {
  await c.query(
    `insert into injury_log (tenant_id,date,area,severity,notes)
     values ($1,$2,$3,$4,$5)
     on conflict (tenant_id,date,area) do update set
       severity=coalesce(excluded.severity, injury_log.severity),
       notes=coalesce(excluded.notes, injury_log.notes)`,
    [tenantId, a.date, a.area, a.severity ?? null, a.notes ?? null],
  );
  return `Injury logged: ${a.area} (${a.date}).`;
}
