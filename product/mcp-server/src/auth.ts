import { createHash } from "node:crypto";
import { pool } from "./db.js";

/** Account API keys are stored only as their sha256 hash. */
export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Bearer key → tenant_id, or null if unknown/canceled. */
export async function resolveTenant(apiKey: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    "select id from app.tenants where api_key_hash = $1 and status <> 'canceled' limit 1",
    [hashKey(apiKey)],
  );
  return rows[0]?.id ?? null;
}
