// ────────────────────────────────────────────────────────────────────────────
//  One-shot migration: seed the NEW product project with an existing athlete's
//  data from a backup JSON (produced from the personal project). Non-destructive
//  — reads a file, writes to the new DB. Run once, when the new project exists.
//
//  Usage:
//    DATABASE_URL=postgres://...  TENANT_EMAIL=you@example.com \
//    node migrate.mjs ../backup/personal-data-2026-07-11.json
//
//  Prints the account API key ONCE — save it; it goes in the install kit and is
//  never recoverable (only its hash is stored).
// ────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import pkg from "pg";

const { Client } = pkg;

const BACKUP = process.argv[2] ?? "../backup/personal-data-2026-07-11.json";
const EMAIL = process.env.TENANT_EMAIL ?? "zeroventuno.cc@gmail.com";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Set DATABASE_URL to the NEW product project's connection string.");
  process.exit(1);
}

const backup = JSON.parse(readFileSync(new URL(BACKUP, import.meta.url), "utf8"));

// jsonb / text[] columns per table (everything else is scalar)
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
      return v; // text[] → JS array; scalars as-is
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
  // guard: don't double-migrate
  const existing = await client.query("select id from app.tenants where email=$1", [EMAIL]);
  if (existing.rows.length) {
    console.error(`Tenant ${EMAIL} already exists (${existing.rows[0].id}). Aborting — data may already be migrated.`);
    process.exit(1);
  }

  await client.query("begin");

  // 1) account + API key
  const apiKey = "trak_" + randomBytes(24).toString("hex");
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  const { rows } = await client.query(
    "insert into app.tenants (email, status, plan, api_key_hash) values ($1,'active','pro',$2) returning id",
    [EMAIL, apiKeyHash],
  );
  const tenantId = rows[0].id;
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);

  // 2) profile (full-kit triathlete, race mode) + the A race
  await client.query(
    `insert into profiles (tenant_id, athlete, devices, metrics, mode)
     values ($1,$2,$3,$4,'race')`,
    [
      tenantId,
      "Você",
      ["Garmin"],
      ["hrv", "body_battery", "sleep", "readiness", "power", "zones", "bioimpedance", "nutrition", "strength", "hydration", "protein"],
    ],
  );
  await client.query(
    "insert into races (tenant_id,name,date,priority) values ($1,'IRONMAN 70.3 Costa Navarino','2026-10-25','A')",
    [tenantId],
  );

  // 3) all training data from the backup
  const tables = [
    "training_load", "workouts", "checkins", "phases", "performance_milestones",
    "performance_indicators", "strength_sessions", "injury_log", "body_composition",
    "daily_meal_plan", "nutrition_plan",
  ];
  const counts = {};
  for (const t of tables) counts[t] = await insertRows(client, tenantId, t, backup[t]);

  await client.query("commit");

  console.log("\n✅ Migration complete.");
  console.log("tenant_id:", tenantId);
  console.log("Rows inserted:");
  for (const t of tables) console.log(`  ${t}: ${counts[t]}`);
  console.log("\n──────────────────────────────────────────────");
  console.log("ACCOUNT API KEY (save now — shown only once):");
  console.log("  " + apiKey);
  console.log("──────────────────────────────────────────────\n");
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("Migration failed, rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
