import pkg from "pg";
import type { PoolClient } from "pg";

const { Pool } = pkg;

const url = process.env.DATABASE_URL ?? "";
const isLocal = url.includes("localhost") || url.includes("127.0.0.1");

export const pool = new Pool({
  connectionString: url,
  // Supabase (and any hosted Postgres) requires SSL; local dev doesn't.
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  // On serverless (Vercel) keep the pool tiny — many short-lived instances.
  // Use the Supabase transaction pooler (port 6543) for DATABASE_URL there.
  max: process.env.VERCEL ? 1 : 10,
});

/**
 * Runs `fn` inside a transaction with `app.tenant_id` set to the authenticated
 * tenant, so RLS scopes every statement to that tenant. Commits on success,
 * rolls back on error. This is the ONLY way tools touch the database.
 */
export async function withTenant<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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
