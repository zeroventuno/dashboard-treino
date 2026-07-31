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
        "List the athletes on YOUR roster (the clients you were given access to). Call this FIRST — every write tool takes an `athlete`, and you identify them by the exact name shown here. You can only ever act on athletes in this list.",
      inputSchema: {},
    },
    async () =>
      data(
        await (async () => {
          const { rows } = await pool.query<{ id: string; name: string; email: string }>(
            `select t.id, coalesce(t.athlete_name, t.email) as name, t.email
               from app.staff_athletes sa
               join app.tenants t on t.id = sa.tenant_id
              where sa.staff_id = $1
              order by name`,
            [staff.id],
          );
          return { role: staff.role, count: rows.length, athletes: rows };
        })(),
      ),
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
