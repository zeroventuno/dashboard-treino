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
  { schema: "app",    table: "tenants",     column: "monthly_value", migration: "add-owner-and-value.sql" },
  { schema: "app",    table: "tenants",     column: "nickname",      migration: "add-athlete-admin.sql" },
  { schema: "app",    table: "staff",       column: "is_owner",      migration: "add-owner-and-value.sql" },
  { schema: "app",    table: "staff",       column: "methodology",   migration: "add-staff-methodology.sql" },
  { schema: "app",    table: "agencies",    column: "currency",      migration: "add-owner-and-value.sql" },
];

/** Which required columns are missing, and the migration that adds each. */
export async function schemaCheck(): Promise<{ column: string; migration: string }[]> {
  if (!hasProductDb()) return [];
  const { rows } = await getPool().query<{ table_schema: string; table_name: string; column_name: string }>(
    `select table_schema, table_name, column_name
       from information_schema.columns
      where (table_schema, table_name) in (('public','profiles'),('public','workouts'),
                                           ('app','tenants'),('app','staff'),('app','agencies'))`,
  );
  const present = new Set(rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));
  return REQUIRED_COLUMNS
    .filter((c) => !present.has(`${c.schema}.${c.table}.${c.column}`))
    .map((c) => ({ column: `${c.schema}.${c.table}.${c.column}`, migration: c.migration }));
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
}

/** The agency's professionals, with how many athletes each is assigned. */
export async function listStaff(agencyId: string): Promise<StaffMember[]> {
  if (!hasProductDb()) return [];
  const { rows } = await getPool().query<StaffMember>(
    `select s.id, s.name, s.email, s.role, s.status, s.is_owner, s.sports,
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
