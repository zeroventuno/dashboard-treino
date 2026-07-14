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
