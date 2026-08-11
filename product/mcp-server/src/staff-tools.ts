import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PoolClient } from "pg";
import { pool, withTenant } from "./db.js";
import type { StaffAuth } from "./auth.js";
import {
  resolveRosterAthlete,
  workoutSchema, runWorkout, deleteWorkoutSchema, runDeleteWorkout,
  mealPlanSchema, runMealPlan,
  injurySchema, runInjury,
} from "./writes.js";
import {
  readProfile, readWorkouts, workoutsRangeSchema, readCheckins, checkinsSchema,
  readMealPlan, readBodyComposition, bodyCompositionSchema,
} from "./reads.js";
import { normalizeTags, SUGGESTED_TAGS } from "./bank-tags.js";

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
        "Read a named athlete's config: devices, metrics, race|cycle mode, language, units, target races, active cycle, the season timeline (dated Base/Build/Peak/Taper the athlete sees — phases table, else derived from the cycle), zones, and (if opted in) menstrual cycle. Read before writing so you don't re-ask or overwrite what you can't see.",
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

    server.registerTool(
      "delete_workout",
      {
        description:
          "Remove a session from one athlete on your roster that should never have existed — a mis-typed " +
          "discipline, a duplicate, something entered by hand that their watch later imported properly. " +
          "To call off a session you DID plan, use status cancelled instead: that is a decision, and its " +
          "struck-through row is the record of it. Device-imported sessions are protected.",
        inputSchema: { athlete: z.string(), ...deleteWorkoutSchema },
      },
      async (a) => forAthlete(staff, a.athlete, (c, tid) => runDeleteWorkout(c, tid, a)),
    );

    // ── Workout bank (agency library) — build once, reuse when prescribing ──
    server.registerTool(
      "list_bank",
      {
        description:
          "Read the agency's workout library. Filter by sport/phase/status/tags. When prescribing, draw from status='validated'; 'draft' items are pending your review. " +
          "A library item is a TEMPLATE, not a fixed session: copy its `structure` into upsert_workout and SCALE it to the athlete. Scaling is not proportional — keep the warm-up and cool-down roughly as they are (a beginner needs them just as much), cut the number of reps or the steady middle instead, and NEVER scale `intensity`: it is a percentage of that athlete's own threshold, so it is already personal. A 5x1km threshold run becomes 3x1km for a beginner, never 5x600m. " +
          "Only make a new library item when the block PATTERN differs — same shape at another volume is the same template scaled.",
        inputSchema: {
          sport: z.enum(["swim", "bike", "run", "strength"]).optional(),
          phase: z.string().optional().describe("e.g. Base, Build, Peak, Taper"),
          status: z.enum(["draft", "validated", "archived", "all"]).default("validated"),
          tags: z
            .array(z.string())
            .optional()
            .describe("only workouts carrying ALL of these tags, e.g. [\"threshold\",\"indoor\"] — this is how you find the right session in a big bank"),
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
            const wanted = normalizeTags(a.tags);
            if (wanted.length) { params.push(wanted); conds.push(`tags @> $${params.length}::text[]`); }
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
      "save_plan_block",
      {
        description:
          "Save a MULTI-WEEK block to the agency library — the unit a coach actually decides in. " +
          "Prescribing session by session does not scale past a few dozen athletes; 'this cohort starts " +
          "a four-week Base block on Monday' does. " +
          "IMPORTANT: the sessions carry NO weekday. Which day each lands on is decided per athlete when " +
          "the block is applied, from the availability they filled in themselves — Tuesday is 45 minutes " +
          "for one athlete and three hours for another, and the swim squad meets Thursday for some of " +
          "them and never for the rest. Say how many sessions of what, and let the panel place them. " +
          "Mark the week's long ride or long run with long: true so it lands on a day that can hold it.",
        inputSchema: {
          name: z.string().describe("e.g. 'Base 4 semanas — triatleta 8h'"),
          phase: z.string().optional().describe("Base | Build | Peak | Taper — the cohort it's written for"),
          notes: z.string().optional(),
          weeks: z
            .array(
              z.object({
                focus: z.string().optional().describe("what this week is for, e.g. 'recuperação — segurar'"),
                sessions: z.array(
                  z.object({
                    discipline: z.enum(["swim", "bike", "run", "strength", "rest", "other"]),
                    title: z.string(),
                    duration_min: z.number(),
                    long: z
                      .boolean()
                      .optional()
                      .describe("the week's long session — needs one of the athlete's long days"),
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
                  }),
                ),
              }),
            )
            .describe("One entry per week, in order. The array length IS the block length."),
          status: z.enum(["draft", "active"]).optional(),
        },
      },
      async (a) => {
        const { rows } = await pool.query<{ id: string }>(
          `insert into app.plan_blocks (agency_id, created_by, name, phase, notes, weeks, status)
           values ($1,$2,$3,$4,$5,$6::jsonb,coalesce($7,'draft'))
           returning id`,
          [staff.agencyId, staff.id, a.name, a.phase ?? null, a.notes ?? null, JSON.stringify(a.weeks), a.status ?? null],
        );
        const sessions = a.weeks.reduce((n, w) => n + w.sessions.length, 0);
        return ok(
          `Plan block "${a.name}" saved (${a.weeks.length} weeks, ${sessions} sessions, id ${rows[0].id}). ` +
          `Apply it to a cohort from the panel — it previews where each session lands for each athlete, ` +
          `and what doesn't fit, before anything reaches a calendar.`,
        );
      },
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
          tags: z
            .array(z.string())
            .optional()
            .describe(
              "How this session is classified — what makes a big bank searchable. Don't repeat sport/phase (already columns); tag the FOCUS. Prefer these slugs: " +
              SUGGESTED_TAGS.join(", ") +
              ". Your own terms are fine too; everything is normalized to lowercase-kebab-case.",
            ),
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
            a.validated ? "validated" : "draft", normalizeTags(a.tags),
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
