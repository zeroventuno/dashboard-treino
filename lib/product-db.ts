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
import { summarizeCurve, type RosterLoadSummary } from "./roster-load";
import { extendCurve } from "./pmc-curve";
import { withComputedStress } from "./stress";
import type { PerformanceIndicators, Workout, ZoneSeconds } from "./types";
import { distribute, type BlockSession, type PlanWeek } from "./plan-block";
import { WEEKDAYS, type Availability } from "./availability";
import { pickMatch, type Candidate } from "./match-activity";
import { isTimezone, resolveTimezone } from "./agency-clock";
import { isCurrency } from "./currencies";
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
  { schema: "app",    table: "agencies",    column: "timezone",      migration: "add-agency-timezone.sql" },
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
  { kind: "function", schema: "app", name: "roster_load",          migration: "add-roster-load.sql" },
  { kind: "function", schema: "app", name: "agency_athlete_sports", migration: "add-athlete-sports.sql" },
  { kind: "function", schema: "app", name: "provision_agency",      migration: "add-agency-provisioning.sql" },
  { kind: "table",    schema: "app", name: "agency_invites",       migration: "add-agency-invites.sql" },
  { kind: "table",    schema: "app", name: "athlete_tokens",       migration: "add-athlete-signup.sql" },
  // Lives in `public`, not `app` — and could never be detected until the query
  // below stopped hardcoding the schema.
  { kind: "table",    schema: "public", name: "menstrual_cycle",   migration: "add-menstrual-cycle.sql" },
];

/**
 * Migrations that grant a privilege and create nothing.
 *
 * Invisible to every check above by construction, and one of them matters
 * legally: without `delete on app.tenants` the account-deletion button fails at
 * the moment someone exercises a GDPR right — the worst possible time to find
 * out, and a failure no amount of typechecking catches.
 */
const REQUIRED_GRANTS: { schema: string; table: string; privilege: string; migration: string }[] = [
  { schema: "app", table: "tenants",        privilege: "DELETE", migration: "add-account-deletion.sql" },
  { schema: "app", table: "staff",          privilege: "INSERT", migration: "add-staff-provisioning.sql" },
  { schema: "app", table: "staff_athletes", privilege: "INSERT", migration: "add-staff-provisioning.sql" },
];

/** Which required columns, tables and functions are missing, with their migration. */
export async function schemaCheck(): Promise<{ object: string; migration: string }[]> {
  if (!hasProductDb()) return [];
  const pool = getPool();

  // Derived from the list, never hardcoded: `nspname = 'app'` used to be
  // written into the query, so a required table in `public` was unfindable —
  // the check would pass while the thing it was checking for did not exist.
  const schemas = [...new Set(REQUIRED_OBJECTS.map((o) => o.schema))];

  const [cols, objs, grants] = await Promise.all([
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
        where n.nspname = any($1::text[]) and c.relkind in ('r','p')
       union all
       select 'function', n.nspname, p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = any($1::text[])`,
      [schemas],
    ),
    pool.query<{ table_schema: string; table_name: string; privilege_type: string }>(
      `select table_schema, table_name, privilege_type
         from information_schema.role_table_grants
        where grantee = 'app_writer'`,
    ),
  ]);

  const presentCols = new Set(cols.rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));
  const presentObjs = new Set(objs.rows.map((r) => `${r.kind}:${r.schema}.${r.name}`));
  const presentGrants = new Set(
    grants.rows.map((r) => `${r.table_schema}.${r.table_name}.${r.privilege_type}`),
  );

  return [
    ...REQUIRED_COLUMNS.filter((c) => !presentCols.has(`${c.schema}.${c.table}.${c.column}`)).map((c) => ({
      object: `${c.schema}.${c.table}.${c.column}`,
      migration: c.migration,
    })),
    ...REQUIRED_OBJECTS.filter((o) => !presentObjs.has(`${o.kind}:${o.schema}.${o.name}`)).map((o) => ({
      object: `${o.schema}.${o.name} (${o.kind})`,
      migration: o.migration,
    })),
    ...REQUIRED_GRANTS.filter(
      (g) => !presentGrants.has(`${g.schema}.${g.table}.${g.privilege}`),
    ).map((g) => ({
      object: `grant ${g.privilege.toLowerCase()} on ${g.schema}.${g.table}`,
      migration: g.migration,
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
  /** Agency's IANA time zone. Every coach screen resolves "today" through this
   * rather than the server clock (UTC on Vercel) — see lib/agency-clock. */
  timezone: string;
}

/** professional key (trakc_…) → staff identity, or null if unknown/inactive.
 * The agency must be active too. Mirrors resolveTenantId; app.staff is private
 * and app_writer has SELECT on it. */
export async function resolveStaffId(staffKey: string): Promise<StaffIdentity | null> {
  if (!hasProductDb()) return null;
  const hash = createHash("sha256").update(staffKey).digest("hex");
  const { rows } = await getPool().query<{
    id: string; agency_id: string; role: string; name: string | null; is_owner: boolean;
    currency: string; timezone: string | null;
  }>(
    `select s.id, s.agency_id, s.role, s.name, s.is_owner, a.currency, a.timezone
       from app.staff s
       join app.agencies a on a.id = s.agency_id
      where s.api_key_hash = $1 and s.status = 'active' and a.status = 'active'
      limit 1`,
    [hash],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id, agencyId: r.agency_id, role: r.role, name: r.name, isOwner: r.is_owner,
        currency: r.currency,
        // Resolved here, once, so no caller has to remember the fallback: an
        // agency row written before the migration, or a name this runtime
        // doesn't know, reads as UTC — which is what the panel did before the
        // setting existed.
        timezone: resolveTimezone(r.timezone),
      }
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

// ── RGPD: levar os dados embora, e apagar a conta ───────────────────────────

/**
 * Toda tabela que guarda dado do atleta. Lista fixa, escrita à mão.
 *
 * Deliberadamente NÃO derivada do information_schema: uma lista automática
 * exportaria tabela nova sem ninguém decidir que ela devia sair, e o risco aqui
 * é assimétrico — esquecer uma tabela dá um export incompleto que alguém
 * reclama; incluir a errada publica dado que não devia sair.
 *
 * `app.device_links` fica de fora de propósito: contém tokens de acesso do
 * Strava, que são credenciais nossas para agir em nome dele, não dados pessoais
 * dele. O que interessa — que existe uma conexão e com quem — vai à parte.
 */
const EXPORT_TABLES = [
  "profiles", "workouts", "checkins", "training_load", "races", "phases",
  "training_cycles", "performance_indicators", "performance_milestones",
  "injury_log", "body_composition", "strength_sessions",
  "nutrition_plan", "daily_meal_plan", "menstrual_cycle",
] as const;

/** Tudo que o produto guarda sobre este atleta, num objeto só. */
export async function exportTenantData(tenantId: string): Promise<Record<string, unknown>> {
  if (!hasProductDb()) return {};
  return withTenant(tenantId, async (c) => {
    const out: Record<string, unknown> = {
      exported_at: new Date().toISOString(),
      format: "MY TRAKR export v1",
    };

    const { rows: acc } = await c.query(
      `select email, athlete_name, nickname, phone, plan, status,
              to_char(created_at,'YYYY-MM-DD') as created_at
         from app.tenants where id = $1`,
      [tenantId],
    );
    out.account = acc[0] ?? null;

    // Só o provedor e a data: o token é credencial, não dado pessoal a exportar.
    const { rows: links } = await c.query(
      `select provider, to_char(created_at,'YYYY-MM-DD') as connected_at,
              to_char(last_sync_at,'YYYY-MM-DD') as last_sync_at
         from app.device_links where tenant_id = $1`,
      [tenantId],
    );
    out.connected_devices = links;

    for (const t of EXPORT_TABLES) {
      // Nome vem da constante acima, nunca da requisição.
      const { rows } = await c.query(`select * from ${t} where tenant_id = $1`, [tenantId]);
      out[t] = rows;
    }
    return out;
  });
}

/**
 * Apaga a conta e tudo que pende dela.
 *
 * Uma statement: as 19 tabelas que referenciam `app.tenants` fazem isso com
 * `on delete cascade`, então a linha do tenant é o único ponto a tocar. Deixar
 * a limpeza para o banco é o que garante que uma tabela criada depois não fique
 * para trás só porque ninguém lembrou de acrescentá-la a uma lista.
 *
 * Sem período de carência e sem "desativado": apagar é o que foi pedido, e um
 * apagar que na verdade esconde é a coisa errada a fazer com um pedido de
 * exclusão de dado pessoal.
 */
/** O e-mail da conta — o que a exclusão pede que a pessoa digite de volta. */
export async function getTenantEmail(tenantId: string): Promise<string | null> {
  if (!hasProductDb()) return null;
  const { rows } = await getPool().query<{ email: string }>(
    "select email from app.tenants where id = $1",
    [tenantId],
  );
  return rows[0]?.email ?? null;
}

export async function deleteTenant(tenantId: string): Promise<{ ok: boolean }> {
  if (!hasProductDb()) return { ok: false };
  const { rowCount } = await getPool().query("delete from app.tenants where id = $1", [tenantId]);
  return { ok: (rowCount ?? 0) > 0 };
}

// ── B2C: o atleta se cadastra sozinho, e consegue voltar ────────────────────

/** Quanto tempo um link vale. Cadastro é pós-pagamento e pode esperar o fim de
 * semana; recuperação é alguém trancado do lado de fora agora. */
const SIGNUP_DAYS = 14;
const RECOVER_HOURS = 2;

/**
 * Emite um token e devolve o texto UMA vez — só o hash é gravado.
 *
 * `signup` é chamado depois do pagamento; `recover` pelo formulário público de
 * "perdi minha chave". Quem chama entrega o link ao n8n, que envia o e-mail.
 */
export async function createAthleteToken(input: {
  kind: "signup" | "recover";
  email: string;
  name?: string | null;
  locale?: string | null;
  tenantId?: string | null;
}): Promise<{ token: string; expiresAt: string } | null> {
  if (!hasProductDb()) return null;
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const { rows } = await getPool().query<{ expires_at: string }>(
    `insert into app.athlete_tokens (token_hash, kind, email, name, locale, tenant_id, expires_at)
     values ($1,$2,$3,$4,$5,$6, now() + make_interval(hours => $7))
     returning to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI"Z"') as expires_at`,
    [
      hash, input.kind, input.email.trim().toLowerCase(), input.name ?? null,
      input.locale ?? null, input.tenantId ?? null,
      input.kind === "signup" ? SIGNUP_DAYS * 24 : RECOVER_HOURS,
    ],
  );
  return { token, expiresAt: rows[0].expires_at };
}

/** O que este link promete, sem gastá-lo — o `GET` da tela. Ver o comentário
 * sobre antivírus de e-mail em app/api/coach/setup. */
export async function peekAthleteToken(
  token: string,
): Promise<{ kind: "signup" | "recover"; email: string; name: string | null } | null> {
  if (!hasProductDb()) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const { rows } = await getPool().query<{ kind: "signup" | "recover"; email: string; name: string | null }>(
    `select kind, email, name from app.athlete_tokens
      where token_hash = $1 and used_at is null and expires_at > now()`,
    [hash],
  );
  return rows[0] ?? null;
}

/**
 * Gasta o token: cria a conta, ou rotaciona a chave de quem perdeu a dele.
 * Devolve a chave `trak_` — uma vez, como sempre.
 *
 * A reivindicação é um UPDATE condicional, não um SELECT seguido de UPDATE:
 * `used_at is null` no WHERE é o que impede dois cliques simultâneos de criarem
 * duas contas para o mesmo pagamento.
 */
export async function redeemAthleteToken(
  token: string,
): Promise<
  | { ok: true; key: string; kind: "signup" | "recover" }
  | { ok: false; code: "invalid" | "duplicate_email" }
> {
  if (!hasProductDb()) return { ok: false, code: "invalid" };
  const hash = createHash("sha256").update(token).digest("hex");
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{
      kind: "signup" | "recover"; email: string; name: string | null; locale: string | null; tenant_id: string | null;
    }>(
      `update app.athlete_tokens set used_at = now()
        where token_hash = $1 and used_at is null and expires_at > now()
        returning kind, email, name, locale, tenant_id`,
      [hash],
    );
    const t = rows[0];
    if (!t) { await client.query("rollback"); return { ok: false, code: "invalid" }; }

    // A chave nasce no instante em que será mostrada, nunca quando o link foi
    // criado — senão uma credencial válida ficaria semanas dentro de um e-mail.
    const key = "trak_" + randomBytes(24).toString("hex");
    const keyHash = createHash("sha256").update(key).digest("hex");

    if (t.kind === "recover") {
      await client.query("update app.tenants set api_key_hash = $2 where id = $1", [t.tenant_id, keyHash]);
      await client.query("commit");
      return { ok: true, key, kind: "recover" };
    }

    // plan 'solo' e agency_id nulo: é o atleta direto ao consumidor, sem
    // assessoria. Todo o resto do produto já trata agency_id nulo.
    const { rows: made } = await client.query<{ id: string }>(
      `insert into app.tenants (email, status, plan, api_key_hash, athlete_name)
       values ($1, 'active', 'solo', $2, $3)
       on conflict (email) do nothing
       returning id`,
      [t.email, keyHash, t.name],
    );
    const tenantId = made[0]?.id;
    if (!tenantId) {
      // E-mail já registrado. Devolver o token para que a pessoa possa usar o
      // fluxo de recuperação em vez de ficar com um link queimado e uma conta
      // que ela não sabe que já tem.
      await client.query("rollback");
      return { ok: false, code: "duplicate_email" };
    }

    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(
      `insert into profiles (tenant_id, athlete, mode, locale)
       values ($1, $2, 'race', coalesce($3, 'pt')) on conflict (tenant_id) do nothing`,
      [tenantId, t.name, t.locale],
    );
    await client.query("update app.athlete_tokens set tenant_id = $2 where token_hash = $1", [hash, tenantId]);
    await client.query("commit");
    return { ok: true, key, kind: "signup" };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Pedido público de recuperação.
 *
 * Devolve SEMPRE a mesma coisa, exista o e-mail ou não: um formulário aberto
 * que responde diferente para endereço cadastrado é um verificador de quem usa
 * o produto. Quando o e-mail não existe, nada é criado e nada é enviado.
 *
 * Um link aberto por vez, por tenant — senão o formulário vira um jeito de
 * encher a caixa de e-mail de alguém apertando o botão repetidamente.
 */
export async function requestAthleteRecovery(
  email: string,
): Promise<{ token: string; name: string | null } | null> {
  if (!hasProductDb()) return null;
  const clean = email.trim().toLowerCase();
  const { rows } = await getPool().query<{ id: string; athlete_name: string | null }>(
    "select id, athlete_name from app.tenants where lower(email) = $1 and status = 'active'",
    [clean],
  );
  const t = rows[0];
  if (!t) return null;

  const { rows: open } = await getPool().query(
    `select 1 from app.athlete_tokens
      where tenant_id = $1 and kind = 'recover' and used_at is null and expires_at > now()
      limit 1`,
    [t.id],
  );
  if (open.length > 0) return null;

  const made = await createAthleteToken({ kind: "recover", email: clean, name: t.athlete_name, tenantId: t.id });
  return made ? { token: made.token, name: t.athlete_name } : null;
}

// ── Onboarding de assessoria: convite → assessoria + chave do dono ──────────

/**
 * Cria o convite e devolve o token EM TEXTO, uma única vez.
 *
 * O texto nunca é gravado — só o sha256 — então esta é literalmente a única
 * oportunidade de entregá-lo. Quem chama manda para o n8n, que envia o e-mail.
 */
export async function createAgencyInvite(input: {
  agencyName: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
  currency?: string | null;
  days?: number;
}): Promise<{ token: string; expiresAt: string } | null> {
  if (!hasProductDb()) return null;
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const { rows } = await getPool().query<{ expires_at: string }>(
    `insert into app.agency_invites (token_hash, agency_name, owner_name, owner_email, currency, expires_at)
     values ($1,$2,$3,$4,coalesce(nullif($5,''),'BRL'), now() + make_interval(days => $6))
     returning to_char(expires_at, 'YYYY-MM-DD') as expires_at`,
    [hash, input.agencyName.trim(), input.ownerName ?? null, input.ownerEmail ?? null,
     input.currency ?? "", Math.min(60, Math.max(1, input.days ?? 14))],
  );
  return { token, expiresAt: rows[0].expires_at };
}

/**
 * O que este convite promete, sem gastá-lo.
 *
 * Existe porque o link mágico chega por e-mail, e provedores de e-mail ABREM
 * links para verificá-los. Se um GET consumisse o convite, o antivírus do
 * destinatário queimaria o convite antes do dono ver a tela. Ler é GET, gastar
 * é POST.
 */
export async function peekAgencyInvite(
  token: string,
): Promise<{ agencyName: string; ownerName: string | null } | null> {
  if (!hasProductDb()) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const { rows } = await getPool().query<{ agency_name: string; owner_name: string | null }>(
    `select agency_name, owner_name from app.agency_invites
      where token_hash = $1 and used_at is null and expires_at > now()`,
    [hash],
  );
  return rows[0] ? { agencyName: rows[0].agency_name, ownerName: rows[0].owner_name } : null;
}

/**
 * Gasta o convite e faz nascer a assessoria. Devolve a chave `trakc_` — uma vez.
 *
 * A reivindicação do convite é um UPDATE condicional, não um SELECT seguido de
 * UPDATE: `used_at is null` na cláusula WHERE é o que impede dois cliques
 * simultâneos de criarem duas assessorias. Só quem recebeu linha de volta
 * provisiona.
 */
export async function redeemAgencyInvite(
  token: string,
): Promise<{ ok: true; key: string; agencyName: string } | { ok: false; code: "invalid" }> {
  if (!hasProductDb()) return { ok: false, code: "invalid" };
  const hash = createHash("sha256").update(token).digest("hex");
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{
      id: string; agency_name: string; owner_name: string | null; owner_email: string | null; currency: string;
    }>(
      `update app.agency_invites set used_at = now()
        where token_hash = $1 and used_at is null and expires_at > now()
        returning id, agency_name, owner_name, owner_email, currency`,
      [hash],
    );
    const inv = rows[0];
    if (!inv) {
      await client.query("rollback");
      return { ok: false, code: "invalid" };
    }

    // A chave nasce aqui, no instante em que será mostrada — não quando o
    // convite foi criado, para não existir uma credencial válida parada dentro
    // de uma caixa de e-mail por duas semanas.
    const key = `trakc_${randomBytes(24).toString("hex")}`;
    const keyHash = createHash("sha256").update(key).digest("hex");
    const { rows: made } = await client.query<{ agency_id: string }>(
      "select agency_id from app.provision_agency($1,$2,$3,$4,$5)",
      [inv.agency_name, inv.currency, inv.owner_name, inv.owner_email, keyHash],
    );
    await client.query("update app.agency_invites set agency_id = $2 where id = $1", [inv.id, made[0].agency_id]);
    await client.query("commit");
    return { ok: true, key, agencyName: inv.agency_name };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/** tenant_id → modalidades que o atleta declarou ou treinou. Ver add-athlete-sports.sql. */
export async function getAthleteSports(agencyId: string): Promise<Record<string, string[]>> {
  if (!hasProductDb()) return {};
  const { rows } = await getPool().query<{ tenant_id: string; sports: string[] }>(
    "select tenant_id, sports from app.agency_athlete_sports($1)",
    [agencyId],
  );
  return Object.fromEntries(rows.map((r) => [r.tenant_id, r.sports ?? []]));
}

/**
 * Claim an athlete who is on nobody's book.
 *
 * NOT owner-only, and the distinction is deliberate: picking up an unassigned
 * athlete is a different act from taking one off a colleague. The first is
 * someone stepping up for work nobody has; the second redistributes another
 * professional's book and stays with the owner (see reassignAthletes).
 *
 * The `not exists` in the insert is the whole guard: if anyone has already
 * claimed them between the page rendering and this call, nothing happens and
 * `ok:false` says so, rather than quietly adding a second professional to an
 * athlete who was already handled.
 */
export async function assignUnassignedAthlete(
  agencyId: string,
  tenantId: string,
  staffId: string,
): Promise<{ ok: boolean; code?: "taken" | "not_found" }> {
  if (!hasProductDb()) return { ok: false, code: "not_found" };
  const { rowCount } = await getPool().query(
    `insert into app.staff_athletes (staff_id, tenant_id)
     select s.id, t.id
       from app.staff s, app.tenants t
      where s.id = $1 and t.id = $2
        and s.agency_id = $3 and t.agency_id = $3 and s.status = 'active'
        and not exists (select 1 from app.staff_athletes x where x.tenant_id = t.id)
     on conflict do nothing`,
    [staffId, tenantId, agencyId],
  );
  return (rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: "taken" };
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
    // `created_at` gets the same to_char as the other two, and it is not
    // cosmetic: the function returns it as `timestamptz`, which node-postgres
    // turns into a JS Date — the DATE parser installed at the top of this file
    // does not cover it. Everything downstream expects a 'YYYY-MM-DD' string,
    // so the raw column took the agency page down with `a.slice is not a
    // function` the moment app.agency_attention was re-run to its current
    // version. Coerced here, at the one place that knows what the driver did.
    `select tenant_id, name, email,
            to_char(created_at,'YYYY-MM-DD')   as created_at,
            to_char(last_checkin,'YYYY-MM-DD') as last_checkin,
            to_char(last_done,'YYYY-MM-DD')    as last_done,
            done_recent, done_prev, checkins_recent, staff, staff_ids, monthly_value
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

/** One session row as app.roster_load returns it — the raw material the PMC is
 * built from, plus the thresholds needed to score a session that was never
 * given a TSS by hand. */
interface RosterLoadSessionRow {
  tenant_id: string;
  date: string;
  status: string;
  discipline: string;
  actual_tss: number | null;
  planned_tss: number | null;
  actual_duration_min: number | null;
  actual_power_watts: string | null;
  actual_pace: string | null;
  actual_zones: (ZoneSeconds & { metric?: string }) | null;
  ftp_watts: number | null;
  run_threshold_pace: string | null;
  swim_pace_per_100m: string | null;
}

/**
 * Where each athlete on a professional's roster stands on the fitness/fatigue
 * curve, and which way it is moving.
 *
 * THE CURVE IS BUILT HERE, IN TYPESCRIPT, ON PURPOSE. `training_load` holds
 * exactly these numbers and is empty on every real account — only the one-off
 * import ever wrote it — so a SQL function reading it would have been correct
 * code on a dead table. What the athlete's own chart does instead is derive the
 * curve from their sessions at read time, and this calls the very same two pure
 * functions it calls, in the same order:
 *
 *   withComputedStress  (lib/stress)      — score sessions the coach never did
 *   extendCurve         (lib/pmc-curve)   — the 42d/7d recurrence
 *
 * Doing either of those in SQL would have been a second implementation of an
 * accumulating rule, and CTL integrates everything before it: a small
 * difference compounds instead of cancelling, and the coach's screen and the
 * athlete's screen end up stating different facts about the same person on the
 * same day. The verdict — overreaching, and whether there is enough history to
 * say anything at all — stays in lib/roster-load, the same split as
 * roster_test_dates and lib/testing.
 */
export async function getRosterLoad(staffId: string, todayISO?: string): Promise<RosterLoadSummary[]> {
  if (!hasProductDb()) return [];
  const today = todayISO ?? toISO(new Date());
  try {
    const { rows } = await getPool().query<RosterLoadSessionRow>(
      `select tenant_id, to_char(date,'YYYY-MM-DD') as date, status, discipline,
              actual_tss, planned_tss, actual_duration_min, actual_power_watts,
              actual_pace, actual_zones, ftp_watts, run_threshold_pace, swim_pace_per_100m
         from app.roster_load($1)`,
      [staffId],
    );

    const byTenant = new Map<string, RosterLoadSessionRow[]>();
    for (const r of rows) {
      const list = byTenant.get(r.tenant_id);
      if (list) list.push(r);
      else byTenant.set(r.tenant_id, [r]);
    }

    return [...byTenant.entries()].map(([tenantId, sessions]) => {
      const first = sessions[0];
      const indicators = {
        ftp_watts: first.ftp_watts,
        run_threshold_pace: first.run_threshold_pace,
        swim_pace_per_100m: first.swim_pace_per_100m,
      } as PerformanceIndicators;

      // computeStress reads a handful of fields; the rest of Workout is filled
      // with nulls rather than being made optional, so the compiler keeps this
      // honest if the shared type ever grows a field the curve depends on.
      const workouts: Workout[] = sessions.map((s) => ({
        id: "", title: "", description: null, garmin_instructions: null, zwo_content: null,
        notes: null, nutrition_notes: null,
        planned_duration_min: null, planned_distance_km: null, actual_distance_km: null,
        date: s.date,
        discipline: s.discipline as Workout["discipline"],
        status: s.status as Workout["status"],
        planned_tss: s.planned_tss,
        actual_tss: s.actual_tss,
        actual_duration_min: s.actual_duration_min,
        actual_pace: s.actual_pace,
        actual_power_watts: s.actual_power_watts,
        actual_zones: s.actual_zones,
      }));

      const scored = withComputedStress(workouts, indicators);
      // No stored history to continue from — same empty first argument the
      // athlete's dashboard effectively passes, for the same reason.
      const curve = extendCurve([], scored, today);
      const loaded = scored
        .filter((w) => Number(w.actual_tss ?? w.planned_tss ?? 0) > 0)
        .map((w) => w.date);
      return summarizeCurve(tenantId, curve, loaded, today);
    });
  } catch (err) {
    // Same bargain as the two readers above: an agency whose migration hasn't
    // been run yet keeps its roster, minus the load column. /api/health names
    // the missing migration (see REQUIRED_OBJECTS).
    console.warn("[coach] roster_load unavailable — run add-roster-load.sql:", err);
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

// ── Agency settings (owner-only) ────────────────────────────────────────────

/**
 * What the agency IS: what it bills in, and what day it is where it works.
 *
 * Both values are checked HERE and not only at the route. This is the last
 * point where they are still a value rather than a row, and both fail
 * silently-then-loudly if wrong: a currency Intl doesn't know throws mid-render
 * and blanks the owner's screen, and a zone nobody can resolve moves every date
 * in the panel by a day without saying so. Refuse rather than store — the same
 * rule the rest of this file follows for money and pay models.
 *
 * `agencyId` comes from the session, never the request body, and is the
 * authorization boundary on the statement.
 */
export async function updateAgencySettings(
  agencyId: string,
  patch: { currency?: string; timezone?: string },
): Promise<{ ok: boolean; code?: "bad_currency" | "bad_timezone" | "empty" | "not_found" }> {
  if (!hasProductDb()) return { ok: false, code: "not_found" };
  if (patch.currency !== undefined && !isCurrency(patch.currency)) return { ok: false, code: "bad_currency" };
  if (patch.timezone !== undefined && !isTimezone(patch.timezone)) return { ok: false, code: "bad_timezone" };
  if (patch.currency === undefined && patch.timezone === undefined) return { ok: false, code: "empty" };

  // coalesce, so sending one field never blanks the other.
  const { rowCount } = await getPool().query(
    `update app.agencies
        set currency = coalesce($2, currency),
            timezone = coalesce($3, timezone)
      where id = $1`,
    [agencyId, patch.currency ?? null, patch.timezone ?? null],
  );
  return (rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: "not_found" };
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
  /** NUMERIC in Postgres, and lib/product-db parses NUMERIC to a number, so
   * this arrives as a NUMBER despite what a `string` annotation would suggest.
   * Typed loosely on purpose: callers must coerce rather than assume. */
  monthly_value: number | string | null;
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
    // created_at is timestamptz; to_char() here for the same reason it's
    // applied in getAgencyAttention — node-postgres would otherwise hand back
    // a JS Date against a field typed string, unused today but one render away
    // from the same crash that hit /coach/agency twice this week.
    `select t.id as tenant_id, t.athlete_name as name, t.nickname, t.phone, t.email,
            t.monthly_value, to_char(t.created_at,'YYYY-MM-DD') as created_at,
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
