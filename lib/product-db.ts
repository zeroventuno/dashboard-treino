// Server-only: direct Postgres access to the product project as a NON-superuser
// role (app_writer), so RLS actually enforces tenant isolation on reads.
//
// Why not supabase-js here? The service-role key BYPASSES RLS — isolation would
// depend purely on us never forgetting a WHERE clause. Connecting as app_writer
// and setting app.tenant_id makes the database itself refuse cross-tenant rows.
import pkg from "pg";
import type { PoolClient } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { normalizeTags } from "./bank-tags";
import type { AttentionRow } from "./retention";
import type { PerformanceIndicators, ZoneSeconds } from "./types";
import { distribute, type BlockSession, type PlanWeek } from "./plan-block";
import { WEEKDAYS, type Availability } from "./availability";
import { pickMatch, type Candidate } from "./match-activity";
import { addDays, parseDate, startOfWeek, toISO } from "./utils";

const { Pool, types } = pkg;

// pg defaults that would break the UI if left alone:
//  • DATE (1082) → JS Date object; we want the raw "YYYY-MM-DD" string.
//  • NUMERIC (1700) → string (to preserve precision); we want a number, or the
//    charts would try to plot "42.5" as text.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));

const url = process.env.PRODUCT_DATABASE_URL ?? "";
const isLocal = url.includes("localhost") || url.includes("127.0.0.1");

export const hasProductDb = () => Boolean(url);

let pool: InstanceType<typeof Pool> | null = null;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
      max: process.env.VERCEL ? 1 : 5, // serverless: use the Supabase txn pooler
    });
  }
  return pool;
}

/** Runs `fn` in a transaction with app.tenant_id set → RLS scopes every query. */
export async function withTenant<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/** Can this deployment actually reach the product database, and does it see the
 * tenants table? Never throws — the caller wants a diagnosis, not an exception. */
export async function healthCheck(): Promise<
  { ok: true; tenants: number; rlsHidingRows?: true } | { ok: false; code: string }
> {
  try {
    const { rows } = await getPool().query<{ n: string }>("select count(*)::text as n from app.tenants");
    const tenants = Number(rows[0].n);
    if (tenants > 0) return { ok: true, tenants };

    // Zero tenants on a reachable database is ambiguous, and the ambiguity is
    // expensive: RLS on app.tenants hides every row from app_writer *silently* —
    // no permission error — so every account key stops resolving and the login
    // blames the key. Name it here instead of leaving a bare 0 to interpret.
    const { rows: sec } = await getPool().query<{ on: boolean }>(
      "select relrowsecurity as on from pg_class where oid = 'app.tenants'::regclass",
    );
    return sec[0]?.on ? { ok: true, tenants, rlsHidingRows: true } : { ok: true, tenants };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { ok: false, code: e.code ?? e.message ?? "unknown" };
  }
}

/**
 * Columns this build's queries require, and which migration adds each.
 *
 * A deployment can be perfectly reachable and still broken, because the code
 * ships before the SQL is run by hand. When that happened the read simply threw,
 * the dashboard fell back to sample data, and it looked to the athlete like
 * their training history had disappeared. Naming the gap turns that into a
 * five-second check.
 *
 * Add a row here whenever a query starts depending on a new column.
 */
const REQUIRED_COLUMNS: { schema: string; table: string; column: string; migration: string }[] = [
  { schema: "public", table: "profiles",    column: "preferences",   migration: "add-athlete-preferences.sql" },
  { schema: "public", table: "workouts",    column: "adherence",     migration: "add-workout-adherence.sql" },
  { schema: "public", table: "workouts",    column: "extra",         migration: "add-workout-extra.sql" },
  { schema: "public", table: "workouts",    column: "external_id",   migration: "add-device-links.sql" },
  { schema: "public", table: "workouts",    column: "actual_zones",  migration: "add-zone-time.sql" },
  { schema: "public", table: "workouts",    column: "actual_rpe",    migration: "add-session-rpe.sql" },
  { schema: "app",    table: "tenants",     column: "monthly_value", migration: "add-owner-and-value.sql" },
  { schema: "app",    table: "tenants",     column: "nickname",      migration: "add-athlete-admin.sql" },
  { schema: "app",    table: "staff",       column: "is_owner",      migration: "add-owner-and-value.sql" },
  { schema: "app",    table: "staff",       column: "methodology",   migration: "add-staff-methodology.sql" },
  { schema: "app",    table: "agencies",    column: "currency",      migration: "add-owner-and-value.sql" },
  { schema: "app",    table: "staff",       column: "max_athletes",  migration: "add-agency-management.sql" },
  { schema: "app",    table: "staff",       column: "pay_model",     migration: "add-agency-management.sql" },
  { schema: "app",    table: "agencies",    column: "methodology",   migration: "add-agency-management.sql" },
];

/**
 * Tables and functions this build calls, and which migration creates each.
 *
 * Columns alone were never enough. Half the B2B migrations don't add a column at
 * all — they create a SECURITY DEFINER function or a whole table — so a build
 * could report a clean schema while `app.roster_test_dates` didn't exist and the
 * coach panel silently lost a section. The check has to cover every KIND of
 * object a migration can create, not just the kind that happened to break first.
 */
const REQUIRED_OBJECTS: { kind: "table" | "function"; schema: string; name: string; migration: string }[] = [
  { kind: "table",    schema: "app", name: "agencies",            migration: "add-b2b-staff.sql" },
  { kind: "table",    schema: "app", name: "staff",               migration: "add-b2b-staff.sql" },
  { kind: "table",    schema: "app", name: "staff_athletes",      migration: "add-b2b-staff.sql" },
  { kind: "table",    schema: "app", name: "device_links",        migration: "add-device-links.sql" },
  { kind: "table",    schema: "app", name: "workout_bank",        migration: "add-workout-bank.sql" },
  { kind: "table",    schema: "app", name: "plan_blocks",         migration: "add-plan-blocks.sql" },
  { kind: "function", schema: "app", name: "roster_summary",      migration: "add-roster-summary.sql" },
  { kind: "function", schema: "app", name: "agency_attention",    migration: "add-agency-attention.sql" },
  { kind: "function", schema: "app", name: "roster_test_dates",   migration: "add-test-due.sql" },
  { kind: "function", schema: "app", name: "roster_planned_ahead", migration: "add-planned-ahead.sql" },
];

/** Which required columns, tables and functions are missing, with their migration. */
export async function schemaCheck(): Promise<{ object: string; migration: string }[]> {
  if (!hasProductDb()) return [];
  const pool = getPool();

  const [cols, objs] = await Promise.all([
    pool.query<{ table_schema: string; table_name: string; column_name: string }>(
      `select table_schema, table_name, column_name
         from information_schema.columns
        where (table_schema, table_name) in (('public','profiles'),('public','workouts'),
                                             ('app','tenants'),('app','staff'),('app','agencies'))`,
    ),
    // pg_class/pg_proc rather than information_schema: information_schema.routines
    // only shows functions the CURRENT role may execute, so a missing GRANT would
    // read here as a missing function and send someone chasing the wrong fix.
    pool.query<{ kind: string; schema: string; name: string }>(
      `select 'table' as kind, n.nspname as schema, c.relname as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind in ('r','p')
       union all
       select 'function', n.nspname, p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'`,
    ),
  ]);

  const presentCols = new Set(cols.rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));
  const presentObjs = new Set(objs.rows.map((r) => `${r.kind}:${r.schema}.${r.name}`));

  return [
    ...REQUIRED_COLUMNS.filter((c) => !presentCols.has(`${c.schema}.${c.table}.${c.column}`)).map((c) => ({
      object: `${c.schema}.${c.table}.${c.column}`,
      migration: c.migration,
    })),
    ...REQUIRED_OBJECTS.filter((o) => !presentObjs.has(`${o.kind}:${o.schema}.${o.name}`)).map((o) => ({
      object: `${o.schema}.${o.name} (${o.kind})`,
      migration: o.migration,
    })),
  ];
}

// ────────────────────────────────────────────────────────────────────────────
//  Correcting an import that landed on the wrong session.
//
//  The matcher refuses implausible activities now, and Strava's `commute` flag
//  settles the cases the athlete already declared. Neither is enough on its own:
//  most people never tick "commute", and a ride to work that happens to be the
//  length of the day's easy spin is a genuinely ambiguous recording. So the
//  athlete needs to be able to say so afterwards, from the panel, without asking
//  anyone to run SQL or having to phrase it to an AI.
//
//  ORDER OF WRITES, in both functions below: the row holding `external_id` is
//  cleared BEFORE any row is given it. `workouts_external_uniq` is a plain
//  partial unique index, so Postgres enforces it per statement — two rows
//  holding the same external_id, even for the duration of one transaction, is
//  rejected outright. Getting this backwards is exactly what broke
//  relink_activity in production. See product/probe-relink-order.sql.
// ────────────────────────────────────────────────────────────────────────────

type LinkResult = { ok: true } | { ok: false; code: "not_found" | "not_linked" | "target_linked" | "no_db" };

interface LinkedRow {
  id: string; date: string; discipline: string; title: string; external_id: string | null;
  actual_duration_min: number | null; actual_distance_km: string | null;
  actual_pace: string | null; actual_power_watts: string | null;
  actual_tss: string | null; actual_zones: unknown; actual_rpe: number | null;
}

const LINKED_COLS = `id, date, discipline, title, external_id, actual_duration_min,
                     actual_distance_km, actual_pace, actual_power_watts,
                     actual_tss, actual_zones, actual_rpe`;

/** Everything the recording contributed, wiped. The plan — title, blocks, targets — stays. */
const CLEAR_ACTUALS = `external_id = null, status = 'planned',
                       actual_duration_min = null, actual_distance_km = null, actual_pace = null,
                       actual_power_watts = null, actual_tss = null, actual_zones = null,
                       actual_rpe = null, adherence = null`;

/**
 * Detach the imported activity from a session and keep it as an `extra`.
 *
 * The activity is NOT discarded. The athlete really did ride to work, so it
 * belongs in the week's volume — and if we dropped the external_id instead, the
 * next sync would re-import the activity and the matcher would very likely make
 * the same wrong choice again. Landing it as an extra is both honest about what
 * happened and the state the importer would have produced had it refused in the
 * first place.
 */
export async function unlinkActivity(tenantId: string, id: string, extraTitle: string): Promise<LinkResult> {
  if (!hasProductDb()) return { ok: false, code: "no_db" };

  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query<LinkedRow>(
      `select ${LINKED_COLS} from workouts where id = $1`, [id],
    );
    const src = rows[0];
    if (!src) return { ok: false, code: "not_found" } as LinkResult;
    if (!src.external_id) return { ok: false, code: "not_linked" } as LinkResult;

    await c.query(`update workouts set ${CLEAR_ACTUALS} where id = $1`, [src.id]);

    // (tenant_id, date, discipline, title) is unique, and two commutes unlinked
    // on the same day would collide. Suffix rather than upsert: an ON CONFLICT
    // here would silently overwrite the first activity's numbers with the
    // second's and orphan its link.
    const base = extraTitle.trim() || src.discipline;
    let title = base;
    for (let n = 2; n <= 20; n++) {
      const { rows: clash } = await c.query<{ one: number }>(
        `select 1 as one from workouts
          where tenant_id = $1 and date = $2::date and discipline = $3 and title = $4 limit 1`,
        [tenantId, src.date, src.discipline, title],
      );
      if (clash.length === 0) break;
      title = `${base} (${n})`;
    }

    await c.query(
      `insert into workouts
         (tenant_id, date, discipline, title, status, extra, external_id,
          actual_duration_min, actual_distance_km, actual_pace, actual_power_watts,
          actual_tss, actual_zones, actual_rpe)
       values ($1,$2::date,$3,$4,'done',true,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
      [
        tenantId, src.date, src.discipline, title, src.external_id,
        src.actual_duration_min, src.actual_distance_km, src.actual_pace, src.actual_power_watts,
        src.actual_tss, src.actual_zones ? JSON.stringify(src.actual_zones) : null, src.actual_rpe,
      ],
    );
    return { ok: true } as LinkResult;
  });
}

/**
 * Move the imported activity from one session to another on the athlete's panel.
 *
 * Refuses when the destination already has its own activity: overwriting it
 * would leave that recording with no row pointing at it, so the athlete would
 * have silently traded one wrong link for another. Unlink that one first.
 */
export async function relinkActivity(tenantId: string, fromId: string, toId: string): Promise<LinkResult> {
  if (!hasProductDb()) return { ok: false, code: "no_db" };
  if (fromId === toId) return { ok: false, code: "not_found" };

  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query<LinkedRow>(
      `select ${LINKED_COLS} from workouts where id = any($1::uuid[])`, [[fromId, toId]],
    );
    const src = rows.find((r) => r.id === fromId);
    const dst = rows.find((r) => r.id === toId);
    if (!src || !dst) return { ok: false, code: "not_found" } as LinkResult;
    if (!src.external_id) return { ok: false, code: "not_linked" } as LinkResult;
    if (dst.external_id) return { ok: false, code: "target_linked" } as LinkResult;

    await c.query(`update workouts set ${CLEAR_ACTUALS} where id = $1`, [src.id]);
    await c.query(
      `update workouts set
         external_id = $2, status = 'done',
         actual_duration_min = $3, actual_distance_km = $4, actual_pace = $5,
         actual_power_watts = $6, actual_tss = $7, actual_zones = $8::jsonb, actual_rpe = $9
       where id = $1`,
      [
        dst.id, src.external_id, src.actual_duration_min, src.actual_distance_km,
        src.actual_pace, src.actual_power_watts, src.actual_tss,
        src.actual_zones ? JSON.stringify(src.actual_zones) : null, src.actual_rpe,
      ],
    );
    return { ok: true } as LinkResult;
  });
}

/** account API key → tenant_id (app.tenants is private; app_writer has SELECT). */
export async function resolveTenantId(accountKey: string): Promise<string | null> {
  if (!hasProductDb()) return null;
  const hash = createHash("sha256").update(accountKey).digest("hex");
  const { rows } = await getPool().query<{ id: string }>(
    "select id from app.tenants where api_key_hash = $1 and status <> 'canceled' limit 1",
    [hash],
  );
  return rows[0]?.id ?? null;
}

// ── B2B: professional (coach/nutritionist/physio) auth + roster ─────────────

export interface StaffIdentity {
  id: string;
  agencyId: string;
  role: string;
  name: string | null;
  /** Owns the agency: sees every professional's book, not just their own.
   * A flag rather than a role — the founder usually coaches too. */
  isOwner: boolean;
  /** Agency's billing currency, for the value figures. */
  currency: string;
}

/** professional key (trakc_…) → staff identity, or null if unknown/inactive.
 * The agency must be active too. Mirrors resolveTenantId; app.staff is private
 * and app_writer has SELECT on it. */
export async function resolveStaffId(staffKey: string): Promise<StaffIdentity | null> {
  if (!hasProductDb()) return null;
  const hash = createHash("sha256").update(staffKey).digest("hex");
  const { rows } = await getPool().query<{
    id: string; agency_id: string; role: string; name: string | null; is_owner: boolean; currency: string;
  }>(
    `select s.id, s.agency_id, s.role, s.name, s.is_owner, a.currency
       from app.staff s
       join app.agencies a on a.id = s.agency_id
      where s.api_key_hash = $1 and s.status = 'active' and a.status = 'active'
      limit 1`,
    [hash],
  );
  const r = rows[0];
  return r
    ? { id: r.id, agencyId: r.agency_id, role: r.role, name: r.name, isOwner: r.is_owner, currency: r.currency }
    : null;
}

/** One summary row per athlete on a staff member's roster, for the team view. */
export interface RosterAthlete {
  tenant_id: string;
  name: string;
  athlete: string | null;
  mode: string | null;
  /** Current phase of the active cycle (Base/Build/…) — the cohort a coach
   * batches by. Null when there's no active cycle. */
  current_phase: string | null;
  /** Disciplines the athlete actually trains (distinct workout disciplines,
   * minus rest): the swim/bike/run/strength icons the card lights up. */
  sports: string[];
  /** Capability flags the athlete declared (power, hrv, bioimpedance, …) — the
   * metric icons on the card. */
  metrics: string[];
  next_race_name: string | null;
  next_race_date: string | null;
  today_reco: "green" | "yellow" | "red" | null;
  last_checkin: string | null;
  recent_injuries: number;
  injury_severity: number | null;
}

/** The whole roster in one query, via the app.roster_summary SECURITY DEFINER
 * function — which is itself scoped to this staff member (see the migration). */
export async function getRoster(staffId: string): Promise<RosterAthlete[]> {
  if (!hasProductDb()) return [];
  const { rows } = await getPool().query<RosterAthlete>(
    "select * from app.roster_summary($1)",
    [staffId],
  );
  return rows;
}

/** Is this athlete on this staff member's roster? The authorization gate for the
 * drill-in: a professional may only open an athlete assigned to them. */
export async function staffCanAccess(staffId: string, tenantId: string): Promise<boolean> {
  if (!hasProductDb()) return false;
  const { rows } = await getPool().query(
    "select 1 from app.staff_athletes where staff_id = $1 and tenant_id = $2 limit 1",
    [staffId, tenantId],
  );
  return rows.length > 0;
}

/**
 * Athletes of this agency on nobody's book.
 *
 * Not a database error — an athlete WAITING. They were registered, they may
 * already be paying, and until someone assigns them they are invisible to every
 * professional in the panel: they appear in no roster, so no one is prompted to
 * write them a session. Nothing surfaced this state before, which is exactly why
 * it could persist quietly.
 */
export async function getUnassignedAthletes(
  agencyId: string,
): Promise<{ tenant_id: string; name: string; created_at: string }[]> {
  if (!hasProductDb()) return [];
  const { rows } = await getPool().query<{ tenant_id: string; name: string; created_at: string }>(
    `select t.id as tenant_id,
            coalesce(nullif(trim(t.athlete_name), ''), t.email) as name,
            to_char(t.created_at,'YYYY-MM-DD') as created_at
       from app.tenants t
      where t.agency_id = $1
        and not exists (select 1 from app.staff_athletes sa where sa.tenant_id = t.id)
      order by t.created_at`,
    [agencyId],
  );
  return rows;
}

/** One athlete changing hands: off `from`'s book, onto `to`'s. */
export interface Reassignment {
  tenantId: string;
  fromStaffId: string;
  toStaffId: string;
}

/**
 * Apply a batch of roster moves.
 *
 * ONE transaction for the whole batch. Reallocating a book is a decision the
 * owner makes as a whole — half of it landing would leave a distribution nobody
 * chose, and the preview they just approved would describe a state that never
 * existed.
 *
 * Both staff ids are re-checked against THIS agency inside the statement rather
 * than trusted from the request: the ids come from the browser, and the whole
 * point of the screen is that they are user-supplied. An athlete of another
 * agency, or a staff id from another agency, matches nothing and moves nothing.
 */
export async function reassignAthletes(
  agencyId: string,
  moves: Reassignment[],
): Promise<{ ok: boolean; moved: number }> {
  if (!hasProductDb() || moves.length === 0) return { ok: true, moved: 0 };

  const client = await getPool().connect();
  try {
    await client.query("begin");
    let moved = 0;
    for (const m of moves) {
      // Delete first: an athlete already on the destination's book would make
      // the insert a no-op, and doing it in this order means a move onto a book
      // that already holds them still cleanly LEAVES the source.
      const del = await client.query(
        `delete from app.staff_athletes sa
          using app.staff s, app.tenants t
          where sa.staff_id = s.id and sa.tenant_id = t.id
            and sa.staff_id = $1 and sa.tenant_id = $2
            and s.agency_id = $3 and t.agency_id = $3`,
        [m.fromStaffId, m.tenantId, agencyId],
      );
      if ((del.rowCount ?? 0) === 0) continue; // not this agency's to move

      await client.query(
        `insert into app.staff_athletes (staff_id, tenant_id)
         select s.id, t.id from app.staff s, app.tenants t
          where s.id = $1 and t.id = $2 and s.agency_id = $3 and t.agency_id = $3
            and s.status = 'active'
         on conflict do nothing`,
        [m.toStaffId, m.tenantId, agencyId],
      );
      moved++;
    }
    await client.query("commit");
    return { ok: true, moved };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// ── Workout bank (agency library) ───────────────────────────────────────────

export interface BankWorkout {
  id: string;
  sport: string;
  phase: string | null;
  title: string;
  structure: unknown;
  duration_min: number | null;
  tss: number | null;
  description: string | null;
  source: string;
  status: "draft" | "validated" | "archived";
  tags: string[];
  created_at: string;
}

/** The agency's library (excluding archived by default), for the /coach/bank view. */
export async function getBank(agencyId: string): Promise<BankWorkout[]> {
  if (!hasProductDb()) return [];
  const { rows } = await getPool().query<BankWorkout>(
    `select id, sport, phase, title, structure, duration_min, tss, description, source, status, tags, created_at
       from app.workout_bank
      where agency_id = $1 and status <> 'archived'
      order by sport, phase nulls last, status desc, title`,
    [agencyId],
  );
  // Normalize on read: rows written before tags were normalized (or imported by
  // hand) shouldn't split the filter bar into "VO2 Max" vs "vo2max".
  return rows.map((r) => ({ ...r, tags: normalizeTags(r.tags) }));
}

/** Validate/archive one library item — scoped to the agency (authorization). */
export async function setBankStatus(
  agencyId: string,
  id: string,
  status: "draft" | "validated" | "archived",
): Promise<boolean> {
  if (!hasProductDb()) return false;
  const { rowCount } = await getPool().query(
    "update app.workout_bank set status = $3 where id = $1 and agency_id = $2",
    [id, agencyId, status],
  );
  return (rowCount ?? 0) > 0;
}

// ── Rescheduling (athlete drags a session to another day) ───────────────────

export type MoveResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "not_movable" | "same_date" | "no_db" };

/**
 * Reschedule one session, using the SAME model the coach briefing teaches the
 * AI: the original stays put marked `moved` (struck through in the calendar, a
 * visible breadcrumb of what was pushed) and a fresh `planned` copy lands on the
 * new date. Nothing is deleted, the weekly box already drops `moved` from every
 * total, and the coach reads the history on the next get_workouts.
 *
 * Only a session that hasn't happened can move: `done` is a fact about a day.
 * Runs inside withTenant, so RLS refuses another tenant's row even if an id leaks.
 */
export async function moveWorkout(tenantId: string, id: string, toDate: string): Promise<MoveResult> {
  if (!hasProductDb()) return { ok: false, code: "no_db" };
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query<{ status: string; date: string }>(
      "select status, to_char(date,'YYYY-MM-DD') as date from workouts where id = $1",
      [id],
    );
    const current = rows[0];
    if (!current) return { ok: false, code: "not_found" } as const;
    if (current.date === toDate) return { ok: false, code: "same_date" } as const;
    // `done` already happened; `cancelled`/`moved` are out of the plan already.
    if (current.status !== "planned" && current.status !== "skipped") {
      return { ok: false, code: "not_movable" } as const;
    }

    // Copy the PLAN (never the actuals — the copy hasn't been trained yet).
    await c.query(
      `insert into workouts
         (tenant_id, date, discipline, title, status, description, garmin_instructions, zwo_content,
          planned_duration_min, planned_distance_km, planned_tss, planned_pace, planned_power_watts,
          notes, nutrition_notes, structure, key_workout,
          activation, nutrition_pre, mobility, nutrition_post, muscle_groups)
       select $1, $3::date, discipline, title, 'planned', description, garmin_instructions, zwo_content,
          planned_duration_min, planned_distance_km, planned_tss, planned_pace, planned_power_watts,
          notes, nutrition_notes, structure, key_workout,
          activation, nutrition_pre, mobility, nutrition_post, muscle_groups
         from workouts where id = $2
       on conflict (tenant_id, date, discipline, title) do update set
         status = case when workouts.status = 'done' then workouts.status else 'planned' end`,
      [tenantId, id, toDate],
    );
    await c.query("update workouts set status = 'moved' where id = $1", [id]);
    return { ok: true } as const;
  });
}

/**
 * Bulk cleanup of library items. `archive` is reversible and keeps the row;
 * `delete` is not, which is why the panel makes the coach confirm it separately.
 * Both are agency-scoped: ids from another agency simply match nothing.
 * Returns how many rows were actually affected, so the UI can report the truth
 * rather than assume the whole selection landed.
 */
export async function bulkBankAction(
  agencyId: string,
  ids: string[],
  action: "archive" | "delete",
): Promise<number> {
  if (!hasProductDb() || ids.length === 0) return 0;
  const sql =
    action === "delete"
      ? "delete from app.workout_bank where agency_id = $1 and id = any($2::uuid[])"
      : "update app.workout_bank set status = 'archived' where agency_id = $1 and id = any($2::uuid[])";
  const { rowCount } = await getPool().query(sql, [agencyId, ids]);
  return rowCount ?? 0;
}

/** Replace one library item's tags — the coach's correction of whatever the AI
 * guessed, and the only way to classify items generated before tags existed.
 * Scoped to the agency, same authorization rule as setBankStatus. */
export async function setBankTags(agencyId: string, id: string, tags: string[]): Promise<boolean> {
  if (!hasProductDb()) return false;
  const { rowCount } = await getPool().query(
    "update app.workout_bank set tags = $3::text[] where id = $1 and agency_id = $2",
    [id, agencyId, normalizeTags(tags)],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Engagement facts for every athlete of an agency, for the retention screen.
 * The cross-tenant read happens inside app.agency_attention (SECURITY DEFINER);
 * the agency_id join in the function body is the authorization boundary.
 */
export async function getAgencyAttention(agencyId: string): Promise<AttentionRow[]> {
  if (!hasProductDb()) return [];
  const { rows } = await getPool().query<AttentionRow>(
    `select tenant_id, name, email, created_at,
            to_char(last_checkin,'YYYY-MM-DD') as last_checkin,
            to_char(last_done,'YYYY-MM-DD')    as last_done,
            done_recent, done_prev, checkins_recent, staff
       from app.agency_attention($1)`,
    [agencyId],
  );
  return rows;
}

/** When each athlete on a professional's roster last had a threshold measured.
 *
 * Dates only — the "is it overdue" judgment lives in lib/testing, so the same
 * rule applies here and on the athlete's own dashboard rather than being
 * written twice with two different definitions of six weeks. */
export interface RosterTestDates {
  tenant_id: string;
  ftp_at: string | null;
  run_at: string | null;
  swim_at: string | null;
}

export async function getRosterTestDates(staffId: string): Promise<RosterTestDates[]> {
  if (!hasProductDb()) return [];
  try {
    const { rows } = await getPool().query<RosterTestDates>(
      `select tenant_id,
              to_char(ftp_at,'YYYY-MM-DD')  as ftp_at,
              to_char(run_at,'YYYY-MM-DD')  as run_at,
              to_char(swim_at,'YYYY-MM-DD') as swim_at
         from app.roster_test_dates($1)`,
      [staffId],
    );
    return rows;
  } catch (err) {
    // The panel is worth more without this column than not at all: an agency
    // whose migration hasn't run yet still gets its roster, minus the badges.
    console.warn("[coach] roster_test_dates unavailable — run add-test-due.sql:", err);
    return [];
  }
}

/** How far each athlete's plan actually reaches.
 *
 * The empty week is the failure a coaching business dies of and the one nobody
 * sees: with sixty athletes somebody ends up with nothing scheduled, the
 * athlete opens their dashboard, finds it blank, and leaves — and the retention
 * screen reports it weeks later as a drop-off, which is a post-mortem. */
export interface RosterPlanAhead {
  tenant_id: string;
  planned_7d: number;
  planned_14d: number;
  last_planned: string | null;
}

export async function getRosterPlanAhead(staffId: string): Promise<RosterPlanAhead[]> {
  if (!hasProductDb()) return [];
  try {
    const { rows } = await getPool().query<RosterPlanAhead>(
      `select tenant_id, planned_7d, planned_14d,
              to_char(last_planned,'YYYY-MM-DD') as last_planned
         from app.roster_planned_ahead($1)`,
      [staffId],
    );
    return rows;
  } catch (err) {
    console.warn("[coach] roster_planned_ahead unavailable — run add-planned-ahead.sql:", err);
    return [];
  }
}

/**
 * Put a library workout on athletes' calendars — the step that turns a bank
 * into leverage.
 *
 * The AI path (list_bank → upsert_workout per athlete, in the coach's own chat)
 * has always been able to do this, and remains the right tool when each athlete
 * needs different judgment. It is the wrong tool for the mechanical half of the
 * job: "this threshold session, these forty athletes, Thursday" is one decision
 * and forty identical writes, and typing it out forty times is how a coach
 * stays stuck at thirty athletes.
 *
 * Authorization is doubled on purpose: the workout must belong to the staff's
 * agency, and every athlete must already be on that staff member's roster —
 * ids that fail either test are dropped rather than erroring, so one stale tab
 * can't cancel a legitimate batch. The count of rows actually written comes
 * back so the panel reports what happened instead of what was requested.
 */
// ── Plan blocks (multi-week templates) ──────────────────────────────────────

export interface PlanBlockRow {
  id: string;
  name: string;
  phase: string | null;
  notes: string | null;
  weeks: PlanWeek[];
  status: string;
}

export async function listPlanBlocks(agencyId: string): Promise<PlanBlockRow[]> {
  if (!hasProductDb()) return [];
  try {
    const { rows } = await getPool().query<PlanBlockRow>(
      `select id, name, phase, notes, weeks, status
         from app.plan_blocks
        where agency_id = $1 and status <> 'archived'
        order by phase nulls last, name`,
      [agencyId],
    );
    return rows;
  } catch (err) {
    console.warn("[coach] plan_blocks unavailable — run add-plan-blocks.sql:", err);
    return [];
  }
}

export async function savePlanBlock(
  agencyId: string,
  staffId: string,
  block: { id?: string; name: string; phase?: string | null; notes?: string | null; weeks: PlanWeek[]; status?: string },
): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into app.plan_blocks (id, agency_id, created_by, name, phase, notes, weeks, status)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7::jsonb, coalesce($8,'draft'))
     on conflict (id) do update set
       name = excluded.name, phase = excluded.phase, notes = excluded.notes,
       weeks = excluded.weeks, status = excluded.status, updated_at = now()
     returning id`,
    [block.id ?? null, agencyId, staffId, block.name, block.phase ?? null, block.notes ?? null,
     JSON.stringify(block.weeks), block.status ?? null],
  );
  return rows[0].id;
}

/** One athlete's block, laid out on real dates — computed, never written.
 *
 * The preview exists because the honest answer is sometimes "this doesn't fit".
 * A template built for eight hours applied to an athlete with five has to lose
 * something, and the coach is the one who should decide what — so they see the
 * placement, and what fell off, BEFORE anything reaches a calendar. */
export interface BlockPreview {
  tenantId: string;
  name: string;
  /** date → the sessions landing on it. */
  days: { dateISO: string; session: BlockSession }[];
  unplaced: { week: number; session: BlockSession }[];
}

/**
 * Lay a block over a roster without writing anything.
 *
 * Availability comes from each athlete's own "My week", which is why this can't
 * be a single SQL statement: the same template produces a different calendar per
 * person, and that difference is the entire point.
 */
export async function previewPlanBlock(
  staffId: string,
  agencyId: string,
  blockId: string,
  tenantIds: string[],
  startISO: string,
): Promise<BlockPreview[]> {
  if (!hasProductDb() || tenantIds.length === 0) return [];

  const pool = getPool();
  const { rows: blocks } = await pool.query<{ weeks: PlanWeek[] }>(
    "select weeks from app.plan_blocks where id = $1 and agency_id = $2",
    [blockId, agencyId],
  );
  const weeks = blocks[0]?.weeks ?? [];
  if (weeks.length === 0) return [];

  // Roster boundary: only athletes this professional actually holds.
  const { rows: allowed } = await pool.query<{ tenant_id: string; name: string; preferences: Availability | null }>(
    `select sa.tenant_id,
            coalesce(t.athlete_name, t.email) as name,
            p.preferences
       from app.staff_athletes sa
       join app.tenants t on t.id = sa.tenant_id
       left join public.profiles p on p.tenant_id = sa.tenant_id
      where sa.staff_id = $1 and sa.tenant_id = any($2::uuid[])`,
    [staffId, tenantIds],
  );

  const monday = startOfWeek(parseDate(startISO));

  return allowed.map(({ tenant_id, name, preferences }) => {
    const days: BlockPreview["days"] = [];
    const unplaced: BlockPreview["unplaced"] = [];

    weeks.forEach((week, i) => {
      const { placed, unplaced: missed } = distribute(week, preferences ?? {});
      for (const p of placed) {
        const offset = i * 7 + WEEKDAYS.indexOf(p.day);
        days.push({ dateISO: toISO(addDays(monday, offset)), session: p.session });
      }
      for (const s of missed) unplaced.push({ week: i + 1, session: s });
    });

    days.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
    return { tenantId: tenant_id, name, days, unplaced };
  });
}

/** Write a previewed block. Takes the SAME previews the coach approved rather
 * than recomputing, so what lands on the calendar is exactly what they saw. */
export async function applyPlanBlock(
  staffId: string,
  previews: BlockPreview[],
): Promise<{ written: number; athletes: number }> {
  if (!hasProductDb() || previews.length === 0) return { written: 0, athletes: 0 };

  const pool = getPool();
  const { rows: allowed } = await pool.query<{ tenant_id: string }>(
    "select tenant_id from app.staff_athletes where staff_id = $1 and tenant_id = any($2::uuid[])",
    [staffId, previews.map((p) => p.tenantId)],
  );
  const ok = new Set(allowed.map((r) => r.tenant_id));

  const client = await pool.connect();
  let written = 0;
  let athletes = 0;
  try {
    await client.query("begin");
    for (const preview of previews) {
      if (!ok.has(preview.tenantId)) continue;
      athletes++;
      // Transaction-local, so re-setting per athlete keeps RLS scoped while one
      // connection serves the whole batch.
      await client.query("select set_config('app.tenant_id', $1, true)", [preview.tenantId]);
      for (const { dateISO, session } of preview.days) {
        const { rowCount } = await client.query(
          `insert into workouts
             (tenant_id, date, discipline, title, status, structure, planned_duration_min, key_workout)
           values ($1, $2::date, $3, $4, 'planned', $5::jsonb, $6, coalesce($7,false))
           on conflict (tenant_id, date, discipline, title) do update set
             structure            = coalesce(excluded.structure, workouts.structure),
             planned_duration_min = coalesce(excluded.planned_duration_min, workouts.planned_duration_min),
             key_workout          = coalesce(excluded.key_workout, workouts.key_workout)`,
          [
            preview.tenantId, dateISO, session.discipline, session.title,
            session.structure ? JSON.stringify(session.structure) : null,
            session.duration_min, session.key_workout ?? false,
          ],
        );
        written += rowCount ?? 0;
      }
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return { written, athletes };
}

export async function prescribeFromBank(
  staffId: string,
  agencyId: string,
  bankWorkoutId: string,
  tenantIds: string[],
  date: string,
): Promise<{ written: number; skipped: number }> {
  if (!hasProductDb() || tenantIds.length === 0) return { written: 0, skipped: tenantIds.length };

  const pool = getPool();
  const { rows: bank } = await pool.query<{
    sport: string; title: string; description: string | null;
    structure: unknown; duration_min: number | null; tss: number | null;
  }>(
    `select sport, title, description, structure, duration_min, tss
       from app.workout_bank where id = $1 and agency_id = $2`,
    [bankWorkoutId, agencyId],
  );
  const w = bank[0];
  if (!w) return { written: 0, skipped: tenantIds.length };

  // Only athletes this professional actually holds.
  const { rows: allowed } = await pool.query<{ tenant_id: string }>(
    "select tenant_id from app.staff_athletes where staff_id = $1 and tenant_id = any($2::uuid[])",
    [staffId, tenantIds],
  );
  const targets = allowed.map((r) => r.tenant_id);

  const client = await pool.connect();
  let written = 0;
  try {
    await client.query("begin");
    for (const tenantId of targets) {
      // set_config is transaction-local, so re-setting it per athlete keeps RLS
      // scoped correctly while reusing one connection for the whole batch.
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const { rowCount } = await client.query(
        `insert into workouts
           (tenant_id, date, discipline, title, status, description, structure,
            planned_duration_min, planned_tss)
         values ($1, $2::date, $3, $4, 'planned', $5, $6::jsonb, $7, $8)
         on conflict (tenant_id, date, discipline, title) do update set
           description          = coalesce(excluded.description, workouts.description),
           structure            = coalesce(excluded.structure, workouts.structure),
           planned_duration_min = coalesce(excluded.planned_duration_min, workouts.planned_duration_min),
           planned_tss          = coalesce(excluded.planned_tss, workouts.planned_tss)`,
        [
          tenantId, date, w.sport, w.title, w.description,
          w.structure ? JSON.stringify(w.structure) : null,
          w.duration_min, w.tss,
        ],
      );
      written += rowCount ?? 0;
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return { written, skipped: tenantIds.length - targets.length };
}

// ── Device links (Strava first; provider is open text) ──────────────────────

export interface DeviceLink {
  provider: string;
  external_id: string | null;
  access_token: string;
  refresh_token: string | null;
  /** Unix SECONDS, as Strava issues it — never a formatted string. */
  expires_at: number | null;
  last_sync_at: string | null;
  last_error: string | null;
}

export async function getDeviceLink(tenantId: string, provider: string): Promise<DeviceLink | null> {
  if (!hasProductDb()) return null;
  const { rows } = await getPool().query<DeviceLink>(
    // Formatted with 'OF', these came back as "…T17:23:45+00" — a two-digit
    // offset, which is not valid ISO 8601. Date.parse returned NaN, and NaN
    // fails every comparison silently, so the token refresh below decided the
    // token was fine and never ran. Six hours later Strava answered 401. The
    // same NaN also rendered the athlete's "last synced" as Invalid Date.
    //
    // Expiry comes back as epoch seconds — a number needs no parsing and cannot
    // be ambiguous — and the display timestamp as explicit UTC with a Z.
    `select provider, external_id, access_token, refresh_token,
            extract(epoch from expires_at) as expires_at,
            to_char(last_sync_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_sync_at,
            last_error
       from app.device_links where tenant_id = $1 and provider = $2`,
    [tenantId, provider],
  );
  return rows[0] ?? null;
}

export async function saveDeviceLink(
  tenantId: string,
  provider: string,
  t: { access_token: string; refresh_token?: string | null; expires_at?: number | null; external_id?: string | null; scope?: string | null },
): Promise<void> {
  if (!hasProductDb()) return;
  await getPool().query(
    `insert into app.device_links (tenant_id, provider, external_id, access_token, refresh_token, expires_at, scope)
     values ($1,$2,$3,$4,$5, to_timestamp($6), $7)
     on conflict (tenant_id, provider) do update set
       external_id   = coalesce(excluded.external_id, app.device_links.external_id),
       access_token  = excluded.access_token,
       refresh_token = coalesce(excluded.refresh_token, app.device_links.refresh_token),
       expires_at    = excluded.expires_at,
       scope         = coalesce(excluded.scope, app.device_links.scope),
       last_error    = null`,
    [tenantId, provider, t.external_id ?? null, t.access_token, t.refresh_token ?? null, t.expires_at ?? null, t.scope ?? null],
  );
}

export async function deleteDeviceLink(tenantId: string, provider: string): Promise<void> {
  if (!hasProductDb()) return;
  await getPool().query("delete from app.device_links where tenant_id = $1 and provider = $2", [tenantId, provider]);
}

export async function markSync(tenantId: string, provider: string, error: string | null): Promise<void> {
  if (!hasProductDb()) return;
  await getPool().query(
    `update app.device_links
        set last_sync_at = case when $3::text is null then now() else last_sync_at end,
            last_error   = $3
      where tenant_id = $1 and provider = $2`,
    [tenantId, provider, error],
  );
}

/**
 * Write imported sessions into the athlete's calendar.
 *
 * The interesting part is not the insert, it's the MATCHING. A coach planned
 * "Corrida — Intervalos" for Thursday; the athlete ran it; Strava returns
 * "Afternoon Run". Creating a second row would leave the plan forever unticked
 * and count the session twice in the weekly box. So, in order:
 *
 *   1. Already imported (same external_id) → update it. Re-syncing is safe.
 *   2. A planned session that day, same discipline → the athlete DID the plan.
 *      Mark it done and attach the numbers, keeping the coach's title and blocks.
 *   3. Otherwise → a session nobody planned. Insert it flagged `extra`, which
 *      already means exactly this: counts in volume, not in the plan's x/y.
 */
export async function importWorkouts(
  tenantId: string,
  items: {
    external_id: string; date: string; discipline: string; title: string;
    actual_duration_min: number; actual_distance_km: number | null;
    actual_pace: string | null; actual_power_watts: string | null;
    /** Athlete marked it a commute on the provider — never matched, always extra. */
    commute?: boolean;
  }[],
): Promise<{ matched: number; created: number; updated: number; needsZones: { externalId: string; structure: unknown }[] }> {
  if (!hasProductDb() || items.length === 0) return { matched: 0, created: 0, updated: 0, needsZones: [] };

  return withTenant(tenantId, async (c) => {
    let matched = 0, created = 0, updated = 0;
    // Sessions worth spending a stream call on: they landed on a workout the
    // coach actually structured, so there is a prescription to compare against.
    // Fetching the stream of an unplanned dog walk would burn the same shared
    // allowance to compute a distribution nobody asked for.
    const needsZones: { externalId: string; structure: unknown }[] = [];

    for (const it of items) {
      const { rows: already } = await c.query<{ id: string; structure: unknown; actual_zones: unknown }>(
        "select id, structure, actual_zones from workouts where tenant_id = $1 and external_id = $2",
        [tenantId, it.external_id],
      );
      if (already[0]) {
        // Re-sync: only worth a stream call if it's structured and we never
        // scored it. Otherwise a nightly sync would re-fetch the same streams
        // every night for sessions that already have their zones.
        if (already[0].structure && !already[0].actual_zones) needsZones.push({ externalId: it.external_id, structure: already[0].structure });
        await c.query(
          `update workouts set actual_duration_min = coalesce($2, actual_duration_min),
                               actual_distance_km  = coalesce($3, actual_distance_km),
                               actual_pace         = coalesce($4, actual_pace),
                               actual_power_watts  = coalesce($5, actual_power_watts),
                               status = 'done'
            where id = $1`,
          [already[0].id, it.actual_duration_min, it.actual_distance_km, it.actual_pace, it.actual_power_watts],
        );
        updated++;
        continue;
      }

      // Claim the session that is already on the calendar for that day and
      // sport, so the import lands ON it rather than beside it.
      //
      // `done` belongs in this list, and leaving it out is what duplicated a
      // whole history on the first real sync. An account that has been running
      // for months has almost nothing still sitting at `planned`: the athlete's
      // AI, or the athlete, marked each session done as it happened. Matching
      // only planned/skipped meant every one of those got a second copy from
      // Strava, and the week showed everything twice.
      //
      // `moved` and `cancelled` stay excluded — those are explicitly out of the
      // plan and must not be resurrected by an import.
      //
      // Ordering matters when a day holds more than one candidate: an untouched
      // planned session is the better claim than one already logged, and among
      // equals the key workout wins.
      // Every candidate on the day, then chosen by RESEMBLANCE in code.
      //
      // This used to be `order by … key_workout desc limit 1`, which picked by
      // importance — and on a day holding a short HIIT and a long endurance
      // ride, the ride was the key workout, so it claimed a 32-minute recording
      // and scored 33% adherence while the session it actually was sat
      // untouched. Which session matters most to the week says nothing about
      // which one was just recorded. See lib/match-activity.
      //
      // A commute is exempt from all of it. Strava has a documented `commute`
      // flag the athlete sets themselves, and it settles the question that no
      // amount of duration/title scoring can: a 25-minute ride to work on a day
      // whose planned HIIT is 31 minutes looks like a match by every heuristic
      // and is not one. Where the athlete has told us outright, guessing is
      // strictly worse than listening. It still gets imported — as an `extra`,
      // which is where a ride to work belongs.
      const { rows: candidates } = it.commute
        ? { rows: [] as Candidate[] }
        : await c.query<Candidate>(
            `select id, title, status, key_workout, planned_duration_min, structure
               from workouts
              where tenant_id = $1 and date = $2::date and discipline = $3
                and external_id is null and status in ('planned','skipped','done')`,
            [tenantId, it.date, it.discipline],
          );
      const planned = [pickMatch(candidates, { title: it.title, actual_duration_min: it.actual_duration_min })]
        .filter((x): x is Candidate => x !== null);

      if (planned[0]) {
        // coalesce, not assignment: the device is authoritative for what it
        // measured, but it doesn't measure everything. A ride reports no pace,
        // and a plain assignment would erase a pace the coach had typed in.
        await c.query(
          `update workouts set status = 'done', external_id = $2,
                               actual_duration_min = coalesce($3, actual_duration_min),
                               actual_distance_km  = coalesce($4, actual_distance_km),
                               actual_pace         = coalesce($5, actual_pace),
                               actual_power_watts  = coalesce($6, actual_power_watts)
            where id = $1`,
          [planned[0].id, it.external_id, it.actual_duration_min, it.actual_distance_km, it.actual_pace, it.actual_power_watts],
        );
        matched++;
        if (planned[0].structure) needsZones.push({ externalId: it.external_id, structure: planned[0].structure });
      } else {
        await c.query(
          `insert into workouts
             (tenant_id, date, discipline, title, status, extra, external_id,
              actual_duration_min, actual_distance_km, actual_pace, actual_power_watts)
           values ($1,$2::date,$3,$4,'done',true,$5,$6,$7,$8,$9)
           on conflict (tenant_id, date, discipline, title) do update set
             status = 'done', external_id = excluded.external_id,
             actual_duration_min = excluded.actual_duration_min,
             actual_distance_km  = excluded.actual_distance_km,
             actual_pace         = excluded.actual_pace,
             actual_power_watts  = excluded.actual_power_watts`,
          [
            tenantId, it.date, it.discipline, it.title, it.external_id,
            it.actual_duration_min, it.actual_distance_km, it.actual_pace, it.actual_power_watts,
          ],
        );
        created++;
      }
    }
    return { matched, created, updated, needsZones };
  });
}

/** Attach the reduced stream to an already-imported session. Separate from the
 * import because the stream costs a call each: the import decides WHICH sessions
 * deserve one, this writes the answer back.
 *
 * Takes the packed object — zone seconds plus the metric they were measured in
 * — because a score is only meaningful against a prescription in the same unit.
 * See lib/zone-time's packZones. */
export async function saveWorkoutZones(
  tenantId: string,
  externalId: string,
  zones: Record<string, number | string>,
): Promise<void> {
  if (!hasProductDb()) return;
  await withTenant(tenantId, (c) =>
    c.query(
      "update workouts set actual_zones = $3::jsonb where tenant_id = $1 and external_id = $2",
      [tenantId, externalId, JSON.stringify(zones)],
    ),
  );
}

/** The athlete's stored preferences — needed here for the equipment list, which
 * decides which unit a session is measured in. */
export async function getPreferences(tenantId: string): Promise<Record<string, unknown>> {
  if (!hasProductDb()) return {};
  const { rows } = await withTenant(tenantId, (c) =>
    c.query<{ preferences: Record<string, unknown> | null }>(
      "select preferences from profiles where tenant_id = $1 limit 1",
      [tenantId],
    ),
  );
  return rows[0]?.preferences ?? {};
}

/** The athlete's zone table — needed to turn a raw stream into time in zone.
 *
 * `select *`, matching how data-product.ts and the MCP server already read this
 * table. The hand-written column list this replaced asked for `id`, which the
 * type carries but the table does not: performance_indicators is keyed on
 * tenant_id alone, one row per athlete. Postgres answered `column "id" does not
 * exist` and the whole sync failed after the import had already succeeded. */
export async function getIndicators(tenantId: string): Promise<PerformanceIndicators | null> {
  if (!hasProductDb()) return null;
  const { rows } = await withTenant(tenantId, (c) =>
    c.query<PerformanceIndicators>(
      "select * from performance_indicators where tenant_id = $1 limit 1",
      [tenantId],
    ),
  );
  return rows[0] ?? null;
}

// ── Methodology (the professional's working method) ─────────────────────────
// Also writable from the AI copilot via set_methodology; the panel is the path
// for a coach who'd rather type it than dictate it. Same jsonb, shallow-merged
// so neither side clobbers fields the other set.

export interface Methodology {
  philosophy?: string;
  periodization?: string;
  intensity_distribution?: string;
  defaults?: string;
  notes?: string;
  [k: string]: unknown;
}

export async function getMethodology(staffId: string): Promise<Methodology> {
  if (!hasProductDb()) return {};
  const { rows } = await getPool().query<{ methodology: Methodology }>(
    "select methodology from app.staff where id = $1",
    [staffId],
  );
  return rows[0]?.methodology ?? {};
}

export async function saveMethodology(staffId: string, patch: Methodology): Promise<boolean> {
  if (!hasProductDb()) return false;
  const { rowCount } = await getPool().query(
    "update app.staff set methodology = methodology || $2::jsonb where id = $1",
    [staffId, JSON.stringify(patch)],
  );
  return (rowCount ?? 0) > 0;
}

// ── Staff management (agency team) ──────────────────────────────────────────

export interface StaffMember {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  status: string;
  is_owner: boolean;
  /** Modalities this professional programs; empty = no restriction declared. */
  sports: string[];
  athlete_count: number;
  /** Capacity target and pay model — null until the owner fills them in.
   * See product/add-agency-management.sql. */
  max_athletes: number | null;
  pay_model: "pct" | "per_athlete" | "salary" | null;
  pay_value: number | null;
}

/** The agency's professionals, with how many athletes each is assigned. */
export async function listStaff(agencyId: string): Promise<StaffMember[]> {
  if (!hasProductDb()) return [];
  const { rows } = await getPool().query<StaffMember>(
    `select s.id, s.name, s.email, s.role, s.status, s.is_owner, s.sports,
            s.max_athletes, s.pay_model, s.pay_value,
            (select count(*)::int from app.staff_athletes sa where sa.staff_id = s.id) as athlete_count
       from app.staff s
      where s.agency_id = $1
      order by s.is_owner desc, s.role, s.name nulls last`,
    [agencyId],
  );
  return rows;
}

/**
 * Owner-only edits to a team member: ownership and which modalities they
 * program. Never role or key — those stay provisioning-time decisions.
 *
 * Refuses to remove the last owner: an agency with no owner has no one who can
 * grant ownership back, so the panel would lock itself out permanently.
 */
export async function updateStaff(
  agencyId: string,
  staffId: string,
  patch: { isOwner?: boolean; sports?: string[] },
): Promise<{ ok: boolean; code?: "last_owner" | "not_found" }> {
  if (!hasProductDb()) return { ok: false, code: "not_found" };
  if (patch.isOwner === false) {
    const { rows } = await getPool().query<{ owners: string }>(
      "select count(*) as owners from app.staff where agency_id = $1 and is_owner and status = 'active'",
      [agencyId],
    );
    const { rows: self } = await getPool().query<{ is_owner: boolean }>(
      "select is_owner from app.staff where id = $1 and agency_id = $2",
      [staffId, agencyId],
    );
    if (self[0]?.is_owner && Number(rows[0]?.owners ?? 0) <= 1) return { ok: false, code: "last_owner" };
  }
  const { rowCount } = await getPool().query(
    `update app.staff
        set is_owner = coalesce($3, is_owner),
            sports   = coalesce($4::text[], sports)
      where id = $1 and agency_id = $2`,
    [staffId, agencyId, patch.isOwner ?? null, patch.sports ?? null],
  );
  return (rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: "not_found" };
}

export interface AgencyAthlete {
  tenant_id: string;
  name: string | null;
  nickname: string | null;
  phone: string | null;
  email: string;
  monthly_value: string | null;
  created_at: string;
  staff_ids: string[];
}

/**
 * Register an athlete under the agency and mint their account key.
 *
 * The key is returned in plaintext exactly once — only its hash is stored, so
 * there is no way to recover it later; the caller must show it to the owner
 * there and then. Same contract as createStaff.
 *
 * The profile row has to be written inside withTenant: `profiles` is under RLS,
 * and app_writer can only see rows for the tenant currently set on the session.
 */
export async function createAthlete(
  agencyId: string,
  input: { name: string; email: string; nickname?: string; phone?: string },
): Promise<{ ok: true; tenantId: string; key: string } | { ok: false; code: "duplicate_email" | "no_db" }> {
  if (!hasProductDb()) return { ok: false, code: "no_db" };

  const key = "trak_" + randomBytes(24).toString("hex");
  const hash = createHash("sha256").update(key).digest("hex");
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: string }>(
      `insert into app.tenants (email, status, plan, api_key_hash, agency_id, athlete_name, nickname, phone)
       values ($1, 'active', 'agency', $2, $3, $4, $5, $6)
       on conflict (email) do nothing
       returning id`,
      [input.email, hash, agencyId, input.name, input.nickname ?? null, input.phone ?? null],
    );
    const tenantId = rows[0]?.id;
    // The email is unique across the whole product, not just this agency — an
    // athlete already registered elsewhere has to be moved, not duplicated.
    if (!tenantId) { await client.query("rollback"); return { ok: false, code: "duplicate_email" }; }

    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(
      "insert into profiles (tenant_id, athlete, mode) values ($1, $2, 'race') on conflict (tenant_id) do nothing",
      [tenantId, input.name],
    );
    await client.query("commit");
    return { ok: true, tenantId, key };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/** The athlete admin list — assignment and price live here, not on the
 * dashboard the athlete sees. */
export async function listAgencyAthletes(agencyId: string): Promise<AgencyAthlete[]> {
  if (!hasProductDb()) return [];
  const { rows } = await getPool().query<AgencyAthlete>(
    `select t.id as tenant_id, t.athlete_name as name, t.nickname, t.phone, t.email,
            t.monthly_value, t.created_at,
            coalesce(array_agg(sa.staff_id) filter (where sa.staff_id is not null), '{}') as staff_ids
       from app.tenants t
       left join app.staff_athletes sa on sa.tenant_id = t.id
      where t.agency_id = $1
      group by t.id
      order by coalesce(t.athlete_name, t.email)`,
    [agencyId],
  );
  return rows;
}

/**
 * Owner-only: set what an athlete costs per month and which professionals look
 * after them. Assignment is replaced wholesale — the UI always sends the full
 * set, and a diff would silently keep a professional the owner just unticked.
 */
export async function updateAgencyAthlete(
  agencyId: string,
  tenantId: string,
  patch: { monthlyValue?: number | null; staffIds?: string[]; name?: string; nickname?: string; phone?: string },
): Promise<boolean> {
  if (!hasProductDb()) return false;
  const client = await getPool().connect();
  try {
    await client.query("begin");
    // The agency_id predicate is the authorization boundary on every statement.
    // Empty strings clear nickname/phone; undefined leaves them alone.
    const { rowCount } = await client.query(
      `update app.tenants
          set monthly_value = case when $3::boolean then $4::numeric else monthly_value end,
              athlete_name  = coalesce($5, athlete_name),
              nickname      = case when $6::boolean then nullif($7, '') else nickname end,
              phone         = case when $8::boolean then nullif($9, '') else phone end
        where id = $1 and agency_id = $2`,
      [
        tenantId, agencyId,
        patch.monthlyValue !== undefined, patch.monthlyValue ?? null,
        patch.name ?? null,
        patch.nickname !== undefined, patch.nickname ?? null,
        patch.phone !== undefined, patch.phone ?? null,
      ],
    );
    if ((rowCount ?? 0) === 0) { await client.query("rollback"); return false; }

    if (patch.staffIds) {
      await client.query("delete from app.staff_athletes where tenant_id = $1", [tenantId]);
      if (patch.staffIds.length) {
        await client.query(
          `insert into app.staff_athletes (staff_id, tenant_id)
           select s.id, $2 from app.staff s
            where s.id = any($3::uuid[]) and s.agency_id = $1
           on conflict do nothing`,
          [agencyId, tenantId, patch.staffIds],
        );
      }
    }
    await client.query("commit");
    return true;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/** Provision a new professional under the agency. Returns the plaintext key ONCE
 * (only its sha256 hash is stored) — the caller shows it and never sees it again. */
export async function createStaff(
  agencyId: string,
  input: { name?: string; email?: string; role: string },
): Promise<{ id: string; key: string }> {
  const key = "trakc_" + randomBytes(24).toString("hex");
  const hash = createHash("sha256").update(key).digest("hex");
  const { rows } = await getPool().query<{ id: string }>(
    `insert into app.staff (agency_id, name, email, role, api_key_hash)
     values ($1, $2, $3, $4, $5) returning id`,
    [agencyId, input.name ?? null, input.email ?? null, input.role, hash],
  );
  return { id: rows[0].id, key };
}
