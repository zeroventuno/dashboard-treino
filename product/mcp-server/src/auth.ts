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

/** A professional (coach/nutritionist/physio/…) acting across an agency roster. */
export interface StaffAuth {
  id: string;
  agencyId: string;
  role: string;
}

/** Professional key (trakc_…) → staff identity, or null if unknown/inactive.
 * The agency must be active too — a canceled agency's staff can't authenticate. */
export async function resolveStaff(apiKey: string): Promise<StaffAuth | null> {
  const { rows } = await pool.query<{ id: string; agency_id: string; role: string }>(
    `select s.id, s.agency_id, s.role
       from app.staff s
       join app.agencies a on a.id = s.agency_id
      where s.api_key_hash = $1 and s.status = 'active' and a.status = 'active'
      limit 1`,
    [hashKey(apiKey)],
  );
  const r = rows[0];
  return r ? { id: r.id, agencyId: r.agency_id, role: r.role } : null;
}
