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
          const [profile, races, cycle, indicators] = await Promise.all([
            c.query(
              "select athlete, devices, metrics, mode, locale, units, updated_at from profiles where tenant_id=$1 limit 1",
              [tenantId],
            ),
            c.query("select name, date, priority from races where tenant_id=$1 order by date", [tenantId]),
            c.query(
              "select name, start_date, weeks, phases from training_cycles where tenant_id=$1 and active order by start_date desc limit 1",
              [tenantId],
            ),
            c.query("select * from performance_indicators where tenant_id=$1 limit 1", [tenantId]),
          ]);
          return {
            profile: profile.rows[0] ?? null,
            races: races.rows,
            active_cycle: cycle.rows[0] ?? null,
            indicators: indicators.rows[0] ?? null,
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
            `select date, discipline, title, status, key_workout,
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
        units: z.string().optional(),
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
      const row = await withTenant(tenantId, (c) =>
        c.query(
          // The ::text[] casts are load-bearing. Without them Postgres infers
          // $3 from the bare '{}' literal — which is untyped, so it lands on
          // text — and then refuses to put a text into a text[] column. Every
          // set_profile call failed with a type error the coach saw only as
          // "internal error".
          `insert into profiles (tenant_id, athlete, devices, metrics, mode, locale, units, updated_at)
           values ($1, $2, coalesce($3::text[],'{}'::text[]), coalesce($4::text[],'{}'::text[]),
                   coalesce($5::text,'race'), coalesce($6::text,'pt'), coalesce($7::text,'metric'), now())
           on conflict (tenant_id) do update set
             athlete = coalesce($2::text, profiles.athlete),
             devices = coalesce($3::text[], profiles.devices),
             metrics = coalesce($4::text[], profiles.metrics),
             mode    = coalesce($5::text, profiles.mode),
             locale  = coalesce($6::text, profiles.locale),
             units   = coalesce($7::text, profiles.units),
             updated_at = now()
           returning mode, metrics`,
          [
            tenantId,
            a.athlete ?? null,
            a.devices ?? null,
            a.metrics ?? null,
            a.mode ?? null,
            a.locale ?? null,
            a.units ?? null,
          ],
        ),
      );
      const saved = row.rows[0];
      return ok(`Profile saved — ${saved.mode} mode, ${saved.metrics?.length ?? 0} metrics.`);
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
      description: "Define the current training cycle (cycle mode — training toward a goal with no target race).",
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
        discipline: z.string(),
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
      },
    },
    async (a) => {
      await withTenant(tenantId, (c) =>
        c.query(
          `insert into workouts (tenant_id,date,discipline,title,status,description,garmin_instructions,zwo_content,
             planned_duration_min,actual_duration_min,planned_distance_km,actual_distance_km,planned_tss,actual_tss,
             planned_pace,actual_pace,planned_power_watts,actual_power_watts,notes,nutrition_notes,
             key_workout,structure,activation,nutrition_pre,mobility,nutrition_post)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             coalesce($21,false),$22::jsonb,$23,$24,$25,$26)
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
             nutrition_post=coalesce(excluded.nutrition_post,workouts.nutrition_post)`,
          [
            tenantId, a.date, a.discipline, a.title, a.status, a.description ?? null, a.garmin_instructions ?? null,
            a.zwo_content ?? null, a.planned_duration_min ?? null, a.actual_duration_min ?? null,
            a.planned_distance_km ?? null, a.actual_distance_km ?? null, a.planned_tss ?? null, a.actual_tss ?? null,
            a.planned_pace ?? null, a.actual_pace ?? null, a.planned_power_watts ?? null, a.actual_power_watts ?? null,
            a.notes ?? null, a.nutrition_notes ?? null,
            a.key_workout ?? null, a.structure ? JSON.stringify(a.structure) : null,
            a.activation ?? null, a.nutrition_pre ?? null, a.mobility ?? null, a.nutrition_post ?? null,
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
