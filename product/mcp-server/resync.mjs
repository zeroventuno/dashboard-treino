// ────────────────────────────────────────────────────────────────────────────
//  resync.mjs — mirror the OLD project's current data into the NEW one, for the
//  cut-over. Wipes this tenant's TRAINING data in the product project and
//  re-imports the backup, so both are identical at the moment we switch the coach.
//
//  Idempotent: safe to re-run. Does NOT touch the tenant account or its profile.
//
//  Usage:
//    DATABASE_URL=<product pooler, app_writer> \
//    TENANT_EMAIL=you@example.com \
//    node resync.mjs ../backup/personal-data-2026-07-14.json
// ────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import pkg from "pg";

const { Client } = pkg;

const BACKUP = process.argv[2] ?? "../backup/personal-data-2026-07-14.json";
const EMAIL = process.env.TENANT_EMAIL ?? "zeroventuno.cc@gmail.com";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Set DATABASE_URL to the PRODUCT project (pooler, app_writer).");
  process.exit(1);
}

const backup = JSON.parse(readFileSync(new URL(BACKUP, import.meta.url), "utf8"));

// Order matters only for readability — every table is tenant-scoped.
const TABLES = [
  "training_load", "workouts", "checkins", "phases", "performance_milestones",
  "performance_indicators", "strength_sessions", "injury_log", "body_composition",
  "daily_meal_plan", "nutrition_plan",
];

const TABLE_OPTS = {
  performance_indicators: { jsonb: ["bike_zones", "run_pace_zones", "swim_pace_zones", "hr_zones"] },
  strength_sessions: { jsonb: ["exercises"], arr: ["muscle_groups"] },
  nutrition_plan: { arr: ["supplements_used"] },
};
const DROP = ["id", "created_at", "updated_at"];

async function insertRows(client, tenantId, table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const { jsonb = [], arr = [] } = TABLE_OPTS[table] ?? {};
  let n = 0;
  for (const row of rows) {
    const obj = { ...row };
    for (const d of DROP) delete obj[d];
    obj.tenant_id = tenantId;
    const cols = Object.keys(obj);
    const ph = cols.map((c, i) => {
      const p = `$${i + 1}`;
      if (jsonb.includes(c)) return `${p}::jsonb`;
      if (arr.includes(c)) return `${p}::text[]`;
      return p;
    });
    const values = cols.map((c) => {
      const v = obj[c];
      if (v == null) return null;
      if (jsonb.includes(c)) return JSON.stringify(v);
      return v;
    });
    await client.query(`insert into ${table} (${cols.join(",")}) values (${ph.join(",")})`, values);
    n++;
  }
  return n;
}

const isLocal = DATABASE_URL.includes("localhost") || DATABASE_URL.includes("127.0.0.1");
const client = new Client({
  connectionString: DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});
await client.connect();

try {
  const found = await client.query("select id from app.tenants where email=$1", [EMAIL]);
  if (!found.rows.length) {
    console.error(`Tenant ${EMAIL} não existe no projeto do produto. Rode provision/migrate antes.`);
    process.exit(1);
  }
  const tenantId = found.rows[0].id;

  await client.query("begin");
  // RLS is on: declare the tenant, or app_writer can't touch a single row.
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);

  const deleted = {};
  for (const t of TABLES) {
    const r = await client.query(`delete from ${t} where tenant_id = $1`, [tenantId]);
    deleted[t] = r.rowCount;
  }

  const inserted = {};
  for (const t of TABLES) inserted[t] = await insertRows(client, tenantId, t, backup[t]);

  await client.query("commit");

  console.log("\n✅ Re-sync completo. tenant_id:", tenantId);
  console.log("\ntabela                    apagadas → inseridas");
  console.log("─".repeat(48));
  for (const t of TABLES) {
    console.log(`  ${t.padEnd(24)} ${String(deleted[t]).padStart(3)} → ${String(inserted[t]).padStart(3)}`);
  }
  console.log("\nOs dois bancos agora estão idênticos. Pode virar o coach.\n");
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("Falhou, rollback (nada foi alterado):", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
