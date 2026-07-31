import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withTenant } from "./db.js";
import {
  workoutSchema, runWorkout, mealPlanSchema, runMealPlan, injurySchema, runInjury,
} from "./writes.js";

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
      inputSchema: mealPlanSchema,
    },
    async (a) => ok(await withTenant(tenantId, (c) => runMealPlan(c, tenantId, a))),
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
      inputSchema: workoutSchema,
    },
    async (a) => ok(await withTenant(tenantId, (c) => runWorkout(c, tenantId, a))),
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
      inputSchema: injurySchema,
    },
    async (a) => ok(await withTenant(tenantId, (c) => runInjury(c, tenantId, a))),
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
