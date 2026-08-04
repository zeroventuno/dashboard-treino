import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PoolClient } from "pg";
import { pool, withTenant } from "./db.js";
import type { StaffAuth } from "./auth.js";
import {
  resolveRosterAthlete,
  workoutSchema, runWorkout,
  mealPlanSchema, runMealPlan,
  injurySchema, runInjury,
} from "./writes.js";
import {
  readProfile, readWorkouts, workoutsRangeSchema, readCheckins, checkinsSchema,
  readMealPlan, readBodyComposition, bodyCompositionSchema,
} from "./reads.js";

const data = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/** Every staff write goes through here: resolve the named athlete to a tenant
 * ONLY within this staff member's roster (the authorization boundary), then run
 * the shared write inside that athlete's tenant context. Returns a labelled
 * confirmation so the professional sees which athlete they just touched. */
async function forAthlete(
  staff: StaffAuth,
  athlete: string,
  run: (c: PoolClient, tenantId: string) => Promise<string>,
) {
  const found = await resolveRosterAthlete(staff.id, athlete);
  if (!found) {
    return fail(`No athlete "${athlete}" on your roster. Call list_athletes for the exact names.`);
  }
  const msg = await withTenant(found.tenantId, (c) => run(c, found.tenantId));
  return ok(`[${found.name}] ${msg}`);
}

/** Read variant of forAthlete: resolve + authorize, then return the read as
 * JSON (or a fail if the athlete isn't on this staff member's roster). */
async function readForAthlete(
  staff: StaffAuth,
  athlete: string,
  read: (c: PoolClient, tenantId: string) => Promise<unknown>,
) {
  const found = await resolveRosterAthlete(staff.id, athlete);
  if (!found) {
    return fail(`No athlete "${athlete}" on your roster. Call list_athletes for the exact names.`);
  }
  return data(await withTenant(found.tenantId, (c) => read(c, found.tenantId)));
}

const athleteArg = z.string().describe("athlete name exactly as shown by list_athletes");

/**
 * B2B professional tools, bound to one authenticated staff member (coach,
 * nutritionist, physio, …) acting across their roster. Which write tools exist
 * depends on the role — a nutritionist can't touch training, a physio can't
 * touch the meal plan. The write LOGIC is shared with the athlete path
 * (writes.ts): same SQL, one source of truth.
 */
export function registerStaffTools(server: McpServer, staff: StaffAuth): void {
  // ── Roster (every role) ─────────────────────────────────────────────────
  server.registerTool(
    "list_athletes",
    {
      description:
        "List the athletes on YOUR roster with a summary of each: current training phase (the cohort to batch by), next race, today's readiness traffic-light, last check-in, recent injuries. Call this FIRST — every write tool takes an `athlete`, and you identify them by the exact `name` shown here. You can only ever act on athletes in this list. To prescribe for many at once, group by `current_phase` and skip anyone flagged red or injured until you've read their check-ins.",
      inputSchema: {},
    },
    async () =>
      data(
        await (async () => {
          // Same summary the coach panel shows — the SECURITY DEFINER function is
          // scoped to this staff member, so it only ever returns their roster.
          const { rows } = await pool.query(
            "select * from app.roster_summary($1)",
            [staff.id],
          );
          return { role: staff.role, count: rows.length, athletes: rows };
        })(),
      ),
  );

  // ── Methodology (every role) — the professional's working method, saved once
  //    so drafts come out on-brand and the assistant stops re-asking. ─────────
  server.registerTool(
    "get_methodology",
    {
      description:
        "Read YOUR saved training philosophy / working method. Call at the start of a session so anything you draft matches how this professional actually works.",
      inputSchema: {},
    },
    async () =>
      data(
        await (async () => {
          const { rows } = await pool.query<{ methodology: unknown }>(
            "select methodology from app.staff where id = $1",
            [staff.id],
          );
          return { methodology: rows[0]?.methodology ?? {} };
        })(),
      ),
  );

  server.registerTool(
    "set_methodology",
    {
      description:
        "Save/update YOUR training philosophy so future drafts are on-brand and you stop re-answering the same questions. Run once during setup, update anytime. Only the fields you pass are changed; the rest are kept.",
      inputSchema: {
        philosophy: z.string().optional().describe("your overall approach in a sentence or two"),
        sports: z.array(z.string()).optional().describe("modalities you program, e.g. ['swim','bike','run','strength']"),
        periodization: z.string().optional().describe("e.g. 'linear', 'block', 'reverse'"),
        intensity_distribution: z.string().optional().describe("e.g. '80/20 polarized', 'threshold-heavy'"),
        has_workout_bank: z.boolean().optional().describe("do you have a validated workout library to draw from?"),
        defaults: z.string().optional().describe("default weekly structure / rules of thumb"),
        notes: z.string().optional().describe("anything else that shapes how you write plans"),
      },
    },
    async (a) => {
      // Only the provided keys, shallow-merged into the stored jsonb (`||`), so
      // omitting a field keeps it — same "omit ≠ clear" rule as set_profile.
      const provided: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a)) if (v !== undefined) provided[k] = v;
      if (Object.keys(provided).length === 0) return ok("Nothing to change.");
      await pool.query(
        "update app.staff set methodology = methodology || $2::jsonb where id = $1",
        [staff.id, JSON.stringify(provided)],
      );
      return ok(`Methodology saved (${Object.keys(provided).join(", ")}).`);
    },
  );

  // ── Reads (every role — a professional reads context before acting) ──────
  server.registerTool(
    "get_profile",
    {
      description:
        "Read a named athlete's config: devices, metrics, race|cycle mode, language, units, target races, active cycle, zones, and (if opted in) menstrual cycle. Read before writing so you don't re-ask or overwrite what you can't see.",
      inputSchema: { athlete: athleteArg },
    },
    async (a) => readForAthlete(staff, a.athlete, (c, tid) => readProfile(c, tid)),
  );

  server.registerTool(
    "get_workouts",
    {
      description:
        "Read a named athlete's planned/completed sessions in a date range — build on what's already scheduled instead of duplicating it, and see what they actually did.",
      inputSchema: { ...workoutsRangeSchema, athlete: athleteArg },
    },
    async (a) => readForAthlete(staff, a.athlete, (c, tid) => readWorkouts(c, tid, a.from, a.to)),
  );

  server.registerTool(
    "get_checkins",
    {
      description:
        "Read a named athlete's recent daily check-ins (readiness, HRV, sleep, body battery, the traffic-light). See the trend before prescribing.",
      inputSchema: { ...checkinsSchema, athlete: athleteArg },
    },
    async (a) => readForAthlete(staff, a.athlete, (c, tid) => readCheckins(c, tid, a.days)),
  );

  server.registerTool(
    "get_meal_plan",
    {
      description:
        "Read a named athlete's current nutrition plan: the daily meals and the fueling strategy by duration. Read before set_meal_plan (it replaces each part wholesale). Any role can read; only a nutritionist writes.",
      inputSchema: { athlete: athleteArg },
    },
    async (a) => readForAthlete(staff, a.athlete, (c, tid) => readMealPlan(c, tid)),
  );

  server.registerTool(
    "get_body_composition",
    {
      description:
        "Read a named athlete's recent bioimpedance readings (weight, muscle mass, body-fat %, lean mass, visceral fat, metabolic age), newest first.",
      inputSchema: { ...bodyCompositionSchema, athlete: athleteArg },
    },
    async (a) => readForAthlete(staff, a.athlete, (c, tid) => readBodyComposition(c, tid, a.limit)),
  );

  // ── Role-scoped writes (concrete schemas → the SDK infers args precisely) ─
  if (staff.role === "coach") {
    server.registerTool(
      "upsert_workout",
      {
        description:
          "Create or UPDATE one training session for a named athlete on your roster. When logging a result, update the existing planned row (same date+discipline+title) — never insert a duplicate.",
        inputSchema: { ...workoutSchema, athlete: athleteArg },
      },
      async (a) => forAthlete(staff, a.athlete, (c, tid) => runWorkout(c, tid, a)),
    );

    // ── Workout bank (agency library) — build once, reuse when prescribing ──
    server.registerTool(
      "list_bank",
      {
        description:
          "Read the agency's workout library. Filter by sport/phase/status. When prescribing, draw from status='validated'; 'draft' items are pending your review. Reuse a library workout by copying its `structure` into upsert_workout for the athlete.",
        inputSchema: {
          sport: z.enum(["swim", "bike", "run", "strength"]).optional(),
          phase: z.string().optional().describe("e.g. Base, Build, Peak, Taper"),
          status: z.enum(["draft", "validated", "archived", "all"]).default("validated"),
        },
      },
      async (a) =>
        data(
          await (async () => {
            const conds = ["agency_id = $1"];
            const params: unknown[] = [staff.agencyId];
            if (a.sport) { params.push(a.sport); conds.push(`sport = $${params.length}`); }
            if (a.phase) { params.push(a.phase); conds.push(`phase = $${params.length}`); }
            if (a.status !== "all") { params.push(a.status); conds.push(`status = $${params.length}`); }
            const { rows } = await pool.query(
              `select id, sport, phase, title, structure, duration_min, tss, description, source, status, tags
                 from app.workout_bank where ${conds.join(" and ")} order by sport, phase, title`,
              params,
            );
            return { count: rows.length, workouts: rows };
          })(),
        ),
    );

    server.registerTool(
      "add_bank_workout",
      {
        description:
          "Add a workout to the agency library for reuse. Saves as 'draft' by default — you validate it before it's used in prescription. Same `structure` shape as upsert_workout.",
        inputSchema: {
          sport: z.enum(["swim", "bike", "run", "strength"]),
          title: z.string(),
          phase: z.string().optional().describe("Base | Build | Peak | Taper"),
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
          duration_min: z.number().optional(),
          tss: z.number().optional(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          validated: z.boolean().optional().describe("true = save straight as validated (you're approving it now)"),
        },
      },
      async (a) => {
        await pool.query(
          `insert into app.workout_bank
             (agency_id, created_by, sport, phase, title, structure, duration_min, tss, description, source, status, tags)
           values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,'ai',$10,coalesce($11::text[],'{}'::text[]))`,
          [
            staff.agencyId, staff.id, a.sport, a.phase ?? null, a.title,
            a.structure ? JSON.stringify(a.structure) : null,
            a.duration_min ?? null, a.tss ?? null, a.description ?? null,
            a.validated ? "validated" : "draft", a.tags ?? null,
          ],
        );
        return ok(`Added "${a.title}" (${a.sport}${a.phase ? "/" + a.phase : ""}) to the bank as ${a.validated ? "validated" : "draft"}.`);
      },
    );

    server.registerTool(
      "set_bank_status",
      {
        description: "Validate or archive a library workout by id. Only 'validated' items are used when prescribing.",
        inputSchema: {
          id: z.string().describe("workout id from list_bank"),
          status: z.enum(["draft", "validated", "archived"]),
        },
      },
      async (a) => {
        const { rowCount } = await pool.query(
          "update app.workout_bank set status = $3 where id = $1 and agency_id = $2",
          [a.id, staff.agencyId, a.status],
        );
        return rowCount ? ok(`Library workout ${a.id} → ${a.status}.`) : fail(`No library workout ${a.id} in your agency.`);
      },
    );
  }

  if (staff.role === "nutritionist") {
    server.registerTool(
      "set_meal_plan",
      {
        description:
          "Fill a named athlete's Meal Plan block. Two independent replace-all sections: `meals` (daily eating plan, in order) and `fueling` (pre/during/post-training by session length). Omit a section to keep it; [] to clear. Write all text in the athlete's language.",
        inputSchema: { ...mealPlanSchema, athlete: athleteArg },
      },
      async (a) => forAthlete(staff, a.athlete, (c, tid) => runMealPlan(c, tid, a)),
    );
  }

  if (staff.role === "physio") {
    server.registerTool(
      "log_injury",
      {
        description:
          "Record or update an injury / niggle for a named athlete (Watch Points block). Re-logging the same date+area updates it (e.g. severity dropping as it heals).",
        inputSchema: { ...injurySchema, athlete: athleteArg },
      },
      async (a) => forAthlete(staff, a.athlete, (c, tid) => runInjury(c, tid, a)),
    );
  }
}
