import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withTenant } from "./db.js";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const j = (v: unknown) => (v == null ? null : JSON.stringify(v));

/** Read tools answer with data, not prose — the model parses it. */
const data = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

/**
 * Registers the coach write-tools, all bound to one authenticated tenant.
 * No tool takes a tenant_id — it comes from the API key, so a coach can only
 * ever write to its own athlete. All writes are UPSERTs (never blind inserts)
 * to avoid the duplicate-row problems the dashboard already had.
 */
export function registerTools(server: McpServer, tenantId: string): void {
  // ── Read tools ────────────────────────────────────────────────────────────
  //
  // The server was write-only at first, on the reasoning that the dashboard
  // does the reading. But the coach chat has no memory across sessions: a new
  // conversation knew nothing about the athlete, so it either re-interviewed
  // them or overwrote settings it couldn't see. These close that loop.

  server.registerTool(
    "get_profile",
    {
      description:
        "Read everything already configured for this athlete: devices, available metrics, race|cycle mode, language, target races, active cycle and performance zones. Call this FIRST in a new conversation — it tells you what you already know, so you don't ask again or overwrite settings you can't see.",
      inputSchema: {},
    },
    async () =>
      data(
        await withTenant(tenantId, async (c) => {
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
            // Only meaningful if the athlete opted into the "menstrual" metric;
            // null otherwise. Lets the coach update last_period_start without
            // re-asking, and see it before touching set_menstrual_cycle.
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
        }),
      ),
  );

  server.registerTool(
    "get_workouts",
    {
      description:
        "Read planned/completed sessions in a date range. Use before writing a week so you build on what's already scheduled instead of duplicating or clobbering it, and to see what the athlete actually did.",
      inputSchema: {
        from: z.string().describe("start date, YYYY-MM-DD"),
        to: z.string().describe("end date, YYYY-MM-DD"),
      },
    },
    async (a) =>
      data(
        await withTenant(tenantId, async (c) => {
          const { rows } = await c.query(
            `select date, discipline, title, status, key_workout, muscle_groups,
                    planned_duration_min, planned_tss, actual_duration_min, actual_tss, notes
               from workouts
              where tenant_id=$1 and date between $2 and $3
              order by date`,
            [tenantId, a.from, a.to],
          );
          return { from: a.from, to: a.to, count: rows.length, workouts: rows };
        }),
      ),
  );

  server.registerTool(
    "get_checkins",
    {
      description:
        "Read recent daily check-ins (readiness, HRV, sleep, body battery and the traffic-light you set). Use to see the trend before prescribing — yesterday's number alone doesn't show whether the athlete is climbing out of fatigue or sliding into it.",
      inputSchema: {
        days: z.number().int().min(1).max(90).default(14).describe("how many days back"),
      },
    },
    async (a) =>
      data(
        await withTenant(tenantId, async (c) => {
          const { rows } = await c.query(
            `select date, readiness_score, hrv, sleep_hours, body_battery, resting_hr,
                    recommendation, hydration_liters, notes
               from checkins
              where tenant_id=$1 and date >= current_date - $2::int
              order by date desc`,
            [tenantId, a.days],
          );
          return { days: a.days, count: rows.length, checkins: rows };
        }),
      ),
  );

  // ── Write tools ───────────────────────────────────────────────────────────

  server.registerTool(
    "set_profile",
    {
      description:
        "Set/update the athlete config (devices, available metrics, race|cycle mode). Run during onboarding discovery so the dashboard adapts.",
      inputSchema: {
        athlete: z.string().optional(),
        devices: z.array(z.string()).optional().describe("omit to keep; [] to clear"),
        metrics: z.array(z.string()).optional().describe("omit to keep; [] to clear"),
        mode: z.enum(["race", "cycle"]).optional(),
        locale: z.string().optional(),
        // Drives distance (km↔mi) and weight (kg↔lb) across the dashboard. Pace
        // still renders metric for now.
        units: z
          .enum(["metric", "imperial"])
          .optional()
          .describe("distance & weight display; imperial = mi/lb"),
        // The body figure drawn in the strength/muscle map. It's the drawing,
        // not gender identity — ask which figure the athlete prefers to see.
        anatomy: z
          .enum(["male", "female"])
          .optional()
          .describe("body figure in the muscle map; ask the athlete's preference"),
      },
    },
    async (a) => {
      // Omitted ≠ cleared. This used to overwrite every column, so a later call
      // that only switched the mode would silently wipe devices and metrics —
      // and with metrics gone the dashboard hides the blocks that depend on
      // them. Same shape as the bug that erased a day of check-ins.
      //
      // Passing an explicit [] still clears (an athlete can sell a power meter),
      // so the two intents stay expressible; only the accident is gone. The
      // update references the parameters, not excluded.*, because the INSERT
      // branch already substituted defaults for the nulls.
      await withTenant(tenantId, (c) =>
        c.query(
          // The ::text[] casts are load-bearing. Without them Postgres infers
          // $3 from the bare '{}' literal — which is untyped, so it lands on
          // text — and then refuses to put a text into a text[] column. Every
          // set_profile call failed with a type error the coach saw only as
          // "internal error".
          `insert into profiles (tenant_id, athlete, devices, metrics, mode, locale, units, anatomy, updated_at)
           values ($1, $2, coalesce($3::text[],'{}'::text[]), coalesce($4::text[],'{}'::text[]),
                   coalesce($5::text,'race'), coalesce($6::text,'pt'), coalesce($7::text,'metric'),
                   coalesce($8::text,'male'), now())
           on conflict (tenant_id) do update set
             athlete = coalesce($2::text, profiles.athlete),
             devices = coalesce($3::text[], profiles.devices),
             metrics = coalesce($4::text[], profiles.metrics),
             mode    = coalesce($5::text, profiles.mode),
             locale  = coalesce($6::text, profiles.locale),
             units   = coalesce($7::text, profiles.units),
             anatomy = coalesce($8::text, profiles.anatomy),
             updated_at = now()`,
          [
            tenantId,
            a.athlete ?? null,
            a.devices ?? null,
            a.metrics ?? null,
            a.mode ?? null,
            a.locale ?? null,
            a.units ?? null,
            a.anatomy ?? null,
          ],
        ),
      );
      // No RETURNING. It was the one thing this tool did that no other tool
      // does, and reading a row back just to phrase a nicer confirmation isn't
      // worth being the odd one out while this is the tool that keeps failing.
      // The coach can call get_profile if it wants to see the result.
      const changed = [
        a.athlete !== undefined && "athlete",
        a.devices !== undefined && `${a.devices.length} devices`,
        a.metrics !== undefined && `${a.metrics.length} metrics`,
        a.mode !== undefined && `${a.mode} mode`,
        a.locale !== undefined && `locale ${a.locale}`,
        a.units !== undefined && a.units,
      ].filter(Boolean);
      return ok(
        changed.length > 0
          ? `Profile saved — ${changed.join(", ")}. Fields you omitted were kept.`
          : "Nothing to change.",
      );
    },
  );

  server.registerTool(
    "set_races",
    {
      description: "Replace the athlete's target-race list (race mode). A/B/C priorities.",
      inputSchema: {
        races: z.array(
          z.object({ name: z.string(), date: z.string(), priority: z.enum(["A", "B", "C"]).default("A") }),
        ),
      },
    },
    async (a) => {
      await withTenant(tenantId, async (c) => {
        await c.query("delete from races where tenant_id=$1", [tenantId]);
        for (const r of a.races) {
          await c.query("insert into races (tenant_id,name,date,priority) values ($1,$2,$3,$4)", [
            tenantId,
            r.name,
            r.date,
            r.priority,
          ]);
        }
      });
      return ok(`${a.races.length} race(s) saved.`);
    },
  );

  server.registerTool(
    "set_cycle",
    {
      description:
          "Define the training block and its phases (Base/Build/Peak/Taper). These draw the Season block phase bars for ANY athlete, with or without a race. A race athlete uses this alongside set_races (the cycle gives the phases, the race gives the countdown); a cycle-mode athlete uses it alone. Does not change race|cycle mode; that is set_profile.",
      inputSchema: {
        name: z.string(),
        start_date: z.string(),
        weeks: z.number().int(),
        phases: z
          .array(z.object({ name: z.string(), weeks: z.number().int(), focus: z.string() }))
          .default([]),
      },
    },
    async (a) => {
      await withTenant(tenantId, async (c) => {
        await c.query("update training_cycles set active=false where tenant_id=$1", [tenantId]);
        await c.query(
          "insert into training_cycles (tenant_id,name,start_date,weeks,phases,active) values ($1,$2,$3,$4,$5::jsonb,true)",
          [tenantId, a.name, a.start_date, a.weeks, JSON.stringify(a.phases)],
        );
      });
      return ok(`Cycle "${a.name}" (${a.weeks} weeks, ${a.phases.length} phases) saved.`);
    },
  );

  server.registerTool(
    "set_meal_plan",
    {
      description:
        "Fill the Meal Plan block. Two independent sections, each replace-all: `meals` is the daily eating plan (breakfast → dinner, in the order you list them); `fueling` is the pre/during/post-training strategy bucketed by session length. Omit a section to keep what's there; pass [] to clear it. Write meal names, foods and all text in the athlete's language — the block only translates its own structural labels.",
      inputSchema: {
        meals: z
          .array(
            z.object({
              meal_name: z.string().describe("e.g. Breakfast, Pre-ride snack, Recovery shake"),
              time_suggestion: z.string().optional().describe("HH:MM, or a phrase like 'on waking'"),
              // Rendered with newlines preserved, so a multi-item meal reads as a list.
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
              // These four slugs are load-bearing: the block maps them to labels
              // (Curto/Médio/Longo/Muito longo). Any other value renders raw.
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
      },
    },
    async (a) => {
      // Replace-all per section (same shape as set_races): a meal plan is a
      // cohesive whole, and per-row upsert would leave orphan rows behind when
      // a new plan has fewer meals than the old one. Both run in one
      // transaction (withTenant), so a failure rolls the whole thing back.
      // meal_order is the array index, not a coach-supplied field — the order
      // you list the meals IS the order they eat.
      let mealsN = -1;
      let fuelN = -1;
      await withTenant(tenantId, async (c) => {
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
              // ::text[] cast for the same reason set_profile needs it — keeps a
              // null or an array from being inferred as plain text.
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
      });
      const parts = [
        mealsN >= 0 && `${mealsN} meal(s)`,
        fuelN >= 0 && `${fuelN} fueling rule(s)`,
      ].filter(Boolean);
      return ok(
        parts.length > 0
          ? `Meal plan saved — ${parts.join(", ")}.`
          : "Nothing to change — pass `meals` and/or `fueling`.",
      );
    },
  );

  server.registerTool(
    "set_menstrual_cycle",
    {
      description:
        "Opt-in menstrual-cycle tracking — set up ONLY if the athlete asked for it (sensitive health data). One row per athlete: the dashboard derives today's phase and predicts the next period from these numbers. Update `last_period_start` each time a new period begins to keep the prediction accurate. The block only shows if the athlete also has the `menstrual` metric (add it via set_profile). Store the athlete's preference in your memory and don't re-ask.",
      inputSchema: {
        last_period_start: z.string().describe("day 1 of the most recent period, YYYY-MM-DD"),
        cycle_length: z
          .number()
          .int()
          .min(15)
          .max(60)
          .optional()
          .describe("average cycle length in days (omit to keep; default 28 on first set)"),
        period_length: z
          .number()
          .int()
          .min(1)
          .max(14)
          .optional()
          .describe("average bleeding days (omit to keep; default 5 on first set)"),
        notes: z.string().optional().describe("context in the athlete's language; omit to keep"),
      },
    },
    async (a) => {
      // Upsert on tenant_id (the PK — one row per athlete). last_period_start is
      // always provided, so it's always refreshed; the rest coalesce so omitting
      // them keeps the stored value (same "omit ≠ clear" rule as set_profile).
      await withTenant(tenantId, (c) =>
        c.query(
          `insert into menstrual_cycle (tenant_id, last_period_start, cycle_length, period_length, notes, updated_at)
           values ($1, $2, coalesce($3::int, 28), coalesce($4::int, 5), $5, now())
           on conflict (tenant_id) do update set
             last_period_start = excluded.last_period_start,
             cycle_length      = coalesce($3::int, menstrual_cycle.cycle_length),
             period_length     = coalesce($4::int, menstrual_cycle.period_length),
             notes             = coalesce($5, menstrual_cycle.notes),
             updated_at        = now()`,
          [tenantId, a.last_period_start, a.cycle_length ?? null, a.period_length ?? null, a.notes ?? null],
        ),
      );
      return ok(`Menstrual cycle updated — last period ${a.last_period_start}.`);
    },
  );

  server.registerTool(
    "log_checkin",
    {
      description: "Daily readiness/wellness check-in. Pass only the fields the athlete's device provides; the rest stay hidden.",
      inputSchema: {
        date: z.string(),
        hrv: z.number().optional(),
        sleep_hours: z.number().optional(),
        readiness_score: z.number().optional(),
        body_battery: z.number().optional(),
        resting_hr: z.number().optional(),
        recommendation: z.enum(["green", "yellow", "red"]).optional(),
        hydration_liters: z.number().optional(),
        protein_grams: z.number().optional(),
        notes: z.string().optional(),
      },
    },
    async (a) => {
      await withTenant(tenantId, (c) =>
        c.query(
          `insert into checkins (tenant_id,date,hrv,sleep_hours,readiness_score,body_battery,resting_hr,recommendation,hydration_liters,protein_grams_estimate,notes)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           on conflict (tenant_id,date) do update set
             hrv=coalesce(excluded.hrv, checkins.hrv),
             sleep_hours=coalesce(excluded.sleep_hours, checkins.sleep_hours),
             readiness_score=coalesce(excluded.readiness_score, checkins.readiness_score),
             body_battery=coalesce(excluded.body_battery, checkins.body_battery),
             resting_hr=coalesce(excluded.resting_hr, checkins.resting_hr),
             recommendation=coalesce(excluded.recommendation, checkins.recommendation),
             hydration_liters=coalesce(excluded.hydration_liters, checkins.hydration_liters),
             protein_grams_estimate=coalesce(excluded.protein_grams_estimate, checkins.protein_grams_estimate),
             notes=coalesce(excluded.notes, checkins.notes)`,
          [
            tenantId, a.date, a.hrv ?? null, a.sleep_hours ?? null, a.readiness_score ?? null,
            a.body_battery ?? null, a.resting_hr ?? null, a.recommendation ?? null,
            a.hydration_liters ?? null, a.protein_grams ?? null, a.notes ?? null,
          ],
        ),
      );
      return ok(`Check-in for ${a.date} saved.`);
    },
  );

  server.registerTool(
    "upsert_workout",
    {
      description:
        "Create or UPDATE one session. When logging a result, update the existing planned row (same date+discipline+title) — never insert a duplicate.",
      inputSchema: {
        date: z.string(),
        // Was z.string(), and the dashboard indexes its colour table by this
        // value — so one session written as "cycling" or "ciclismo" resolved to
        // undefined and blanked the whole page at render time. The enum makes
        // the coach fail loudly here instead of the athlete failing silently
        // there, and the error names the accepted values.
        discipline: z
          .enum(["swim", "bike", "run", "strength", "rest"])
          .describe("one of: swim, bike, run, strength, rest — never a translated or free-form name"),
        title: z.string(),
        status: z.enum(["planned", "done", "skipped", "modified"]).default("planned"),
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
        notes: z.string().optional(),
        nutrition_notes: z.string().optional(),

        /** One of the week's priority sessions — starred in the calendar. */
        key_workout: z.boolean().optional(),
        /** Interval blocks — rendered as a profile chart + list in the app.
         *  duration_min accepts decimals; intensity is % of threshold (it only
         *  scales the chart); target is the text the athlete reads. */
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
        /** Pre-workout */
        activation: z.string().optional(),
        nutrition_pre: z.string().optional(),
        /** Post-workout */
        mobility: z.string().optional(),
        nutrition_post: z.string().optional(),
        /** For strength sessions: which muscle groups it works, so the body
         *  heatmap lights up. Use the fixed English slugs below, never exercise
         *  names or other languages — the map keys on these exact values and a
         *  "leg press" or "quadríceps" would light nothing. */
        muscle_groups: z
          .array(z.enum([
            "quadriceps", "glutes", "hamstrings", "core", "shoulders",
            "back", "calves", "chest", "biceps", "triceps",
          ]))
          .optional()
          .describe("strength only; fixed English slugs, e.g. [\"quadriceps\",\"glutes\",\"core\"]"),
      },
    },
    async (a) => {
      await withTenant(tenantId, (c) =>
        c.query(
          `insert into workouts (tenant_id,date,discipline,title,status,description,garmin_instructions,zwo_content,
             planned_duration_min,actual_duration_min,planned_distance_km,actual_distance_km,planned_tss,actual_tss,
             planned_pace,actual_pace,planned_power_watts,actual_power_watts,notes,nutrition_notes,
             key_workout,structure,activation,nutrition_pre,mobility,nutrition_post,muscle_groups)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             coalesce($21,false),$22::jsonb,$23,$24,$25,$26,coalesce($27::text[],'{}'::text[]))
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
             muscle_groups=coalesce($27::text[],workouts.muscle_groups)`,
          [
            tenantId, a.date, a.discipline, a.title, a.status, a.description ?? null, a.garmin_instructions ?? null,
            a.zwo_content ?? null, a.planned_duration_min ?? null, a.actual_duration_min ?? null,
            a.planned_distance_km ?? null, a.actual_distance_km ?? null, a.planned_tss ?? null, a.actual_tss ?? null,
            a.planned_pace ?? null, a.actual_pace ?? null, a.planned_power_watts ?? null, a.actual_power_watts ?? null,
            a.notes ?? null, a.nutrition_notes ?? null,
            a.key_workout ?? null, a.structure ? JSON.stringify(a.structure) : null,
            a.activation ?? null, a.nutrition_pre ?? null, a.mobility ?? null, a.nutrition_post ?? null,
            a.muscle_groups ?? null,
          ],
        ),
      );
      return ok(`Workout "${a.title}" (${a.date}) → ${a.status}${a.key_workout ? " ★" : ""}.`);
    },
  );

  server.registerTool(
    "log_body_composition",
    {
      description: "Bioimpedance entry (only for athletes whose metrics include 'bioimpedance').",
      inputSchema: {
        date: z.string(),
        weight_kg: z.number().optional(),
        body_fat_pct: z.number().optional(),
        muscle_mass_kg: z.number().optional(),
        lean_mass_kg: z.number().optional(),
        visceral_fat: z.number().optional(),
        metabolic_age: z.number().optional(),
        notes: z.string().optional(),
      },
    },
    async (a) => {
      await withTenant(tenantId, (c) =>
        c.query(
          `insert into body_composition (tenant_id,date,weight_kg,body_fat_pct,muscle_mass_kg,lean_mass_kg,visceral_fat,metabolic_age,notes)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           on conflict (tenant_id,date) do update set
             weight_kg=coalesce(excluded.weight_kg, body_composition.weight_kg),
             body_fat_pct=coalesce(excluded.body_fat_pct, body_composition.body_fat_pct),
             muscle_mass_kg=coalesce(excluded.muscle_mass_kg, body_composition.muscle_mass_kg),
             lean_mass_kg=coalesce(excluded.lean_mass_kg, body_composition.lean_mass_kg),
             visceral_fat=coalesce(excluded.visceral_fat, body_composition.visceral_fat),
             metabolic_age=coalesce(excluded.metabolic_age, body_composition.metabolic_age),
             notes=coalesce(excluded.notes, body_composition.notes)`,
          [
            tenantId, a.date, a.weight_kg ?? null, a.body_fat_pct ?? null, a.muscle_mass_kg ?? null,
            a.lean_mass_kg ?? null, a.visceral_fat ?? null, a.metabolic_age ?? null, a.notes ?? null,
          ],
        ),
      );
      return ok(`Body composition for ${a.date} saved.`);
    },
  );

  server.registerTool(
    "log_injury",
    {
      description:
        "Record or update an injury / niggle for the Watch Points block. Without this the coach had no way to log one, so that block read 'all clear' even when it wasn't. Re-logging the same date+area updates it (e.g. severity dropping as it heals).",
      inputSchema: {
        date: z.string().describe("YYYY-MM-DD"),
        area: z.string().describe("body area, e.g. 'left knee', 'lower back'"),
        severity: z.number().int().min(1).max(5).optional().describe("1 mild … 5 severe"),
        notes: z.string().optional(),
      },
    },
    async (a) => {
      await withTenant(tenantId, (c) =>
        c.query(
          `insert into injury_log (tenant_id,date,area,severity,notes)
           values ($1,$2,$3,$4,$5)
           on conflict (tenant_id,date,area) do update set
             severity=coalesce(excluded.severity, injury_log.severity),
             notes=coalesce(excluded.notes, injury_log.notes)`,
          [tenantId, a.date, a.area, a.severity ?? null, a.notes ?? null],
        ),
      );
      return ok(`Injury logged: ${a.area} (${a.date}).`);
    },
  );

  server.registerTool(
    "log_milestone",
    {
      description:
        "Record a performance test result — it appears as a marker on the Season timeline. Use the metric slugs the dashboard labels: 'FTP' (W), 'swim_pace_100m' (min/100m), 'run_pace_threshold' (min/km). Other slugs display as-is. Races belong in set_races, not here.",
      inputSchema: {
        date: z.string().describe("YYYY-MM-DD"),
        metric: z.string().describe("e.g. FTP, swim_pace_100m, run_pace_threshold"),
        value: z.number().optional(),
        unit: z.string().optional().describe("e.g. W, min/km"),
        notes: z.string().optional(),
      },
    },
    async (a) => {
      await withTenant(tenantId, (c) =>
        c.query(
          `insert into performance_milestones (tenant_id,date,metric,value,unit,notes)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (tenant_id,date,metric) do update set
             value=coalesce(excluded.value, performance_milestones.value),
             unit=coalesce(excluded.unit, performance_milestones.unit),
             notes=coalesce(excluded.notes, performance_milestones.notes)`,
          [tenantId, a.date, a.metric, a.value ?? null, a.unit ?? null, a.notes ?? null],
        ),
      );
      return ok(`Milestone logged: ${a.metric}${a.value != null ? ` ${a.value}${a.unit ?? ""}` : ""} (${a.date}).`);
    },
  );

  server.registerTool(
    "set_indicators",
    {
      description: "Performance zones / thresholds (metric: 'zones'). Zone objects are free-form JSON.",
      inputSchema: {
        ftp_watts: z.number().optional(),
        bike_zones: z.record(z.string(), z.any()).optional(),
        run_pace_zones: z.record(z.string(), z.any()).optional(),
        swim_pace_zones: z.record(z.string(), z.any()).optional(),
        swim_pace_per_100m: z.string().optional(),
        run_threshold_pace: z.string().optional(),
        cadence_run_target: z.number().optional(),
        hr_zones: z.record(z.string(), z.any()).optional(),
      },
    },
    async (a) => {
      await withTenant(tenantId, (c) =>
        c.query(
          `insert into performance_indicators (tenant_id,updated_at,ftp_watts,bike_zones,run_pace_zones,swim_pace_zones,swim_pace_per_100m,run_threshold_pace,cadence_run_target,hr_zones)
           values ($1,now(),$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb)
           on conflict (tenant_id) do update set
             updated_at=now(),
             ftp_watts=coalesce(excluded.ftp_watts, performance_indicators.ftp_watts),
             bike_zones=coalesce(excluded.bike_zones, performance_indicators.bike_zones),
             run_pace_zones=coalesce(excluded.run_pace_zones, performance_indicators.run_pace_zones),
             swim_pace_zones=coalesce(excluded.swim_pace_zones, performance_indicators.swim_pace_zones),
             swim_pace_per_100m=coalesce(excluded.swim_pace_per_100m, performance_indicators.swim_pace_per_100m),
             run_threshold_pace=coalesce(excluded.run_threshold_pace, performance_indicators.run_threshold_pace),
             cadence_run_target=coalesce(excluded.cadence_run_target, performance_indicators.cadence_run_target),
             hr_zones=coalesce(excluded.hr_zones, performance_indicators.hr_zones)`,
          [
            tenantId, a.ftp_watts ?? null, j(a.bike_zones), j(a.run_pace_zones), j(a.swim_pace_zones),
            a.swim_pace_per_100m ?? null, a.run_threshold_pace ?? null, a.cadence_run_target ?? null, j(a.hr_zones),
          ],
        ),
      );
      return ok(`Performance indicators saved.`);
    },
  );
}
