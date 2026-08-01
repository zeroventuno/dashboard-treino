// Server-only: direct Postgres access to the product project as a NON-superuser
// role (app_writer), so RLS actually enforces tenant isolation on reads.
//
// Why not supabase-js here? The service-role key BYPASSES RLS — isolation would
// depend purely on us never forgetting a WHERE clause. Connecting as app_writer
// and setting app.tenant_id makes the database itself refuse cross-tenant rows.
import pkg from "pg";
import type { PoolClient } from "pg";
import { createHash } from "node:crypto";

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
}

/** professional key (trakc_…) → staff identity, or null if unknown/inactive.
 * The agency must be active too. Mirrors resolveTenantId; app.staff is private
 * and app_writer has SELECT on it. */
export async function resolveStaffId(staffKey: string): Promise<StaffIdentity | null> {
  if (!hasProductDb()) return null;
  const hash = createHash("sha256").update(staffKey).digest("hex");
  const { rows } = await getPool().query<{ id: string; agency_id: string; role: string; name: string | null }>(
    `select s.id, s.agency_id, s.role, s.name
       from app.staff s
       join app.agencies a on a.id = s.agency_id
      where s.api_key_hash = $1 and s.status = 'active' and a.status = 'active'
      limit 1`,
    [hash],
  );
  const r = rows[0];
  return r ? { id: r.id, agencyId: r.agency_id, role: r.role, name: r.name } : null;
}

/** One summary row per athlete on a staff member's roster, for the team view. */
export interface RosterAthlete {
  tenant_id: string;
  name: string;
  athlete: string | null;
  mode: string | null;
  next_race_name: string | null;
  next_race_date: string | null;
  today_reco: "green" | "yellow" | "red" | null;
  last_checkin: string | null;
  recent_injuries: number;
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
