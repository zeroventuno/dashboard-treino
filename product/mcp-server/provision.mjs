// ────────────────────────────────────────────────────────────────────────────
//  provision.mjs — mint a new tenant (a friend) in the product project.
//  The "manual signup" for the friends-test phase: creates the account + key +
//  a starter profile, and prints a ready-to-send onboarding message.
//
//  Usage (bash):
//    DATABASE_URL=<pooler URL as postgres — NOT app_writer> \
//    TENANT_EMAIL=friend@example.com  TENANT_NAME="Nome do Atleta" \
//    node provision.mjs
//
//  Usage (PowerShell — there's no inline env-var prefix, and single quotes
//  matter: double quotes would interpolate a "$" inside the password):
//    $env:DATABASE_URL = '<pooler URL as postgres>'
//    $env:TENANT_EMAIL = 'friend@example.com'
//    $env:TENANT_NAME  = 'Nome do Atleta'
//    node provision.mjs
//
//  URL-encode the password either way: @ → %40, ! → %21.
//
//  Must run as postgres: app_writer has SELECT on app.tenants and nothing more,
//  on purpose — it's the MCP server's runtime role, and minting accounts isn't
//  something the runtime should ever be able to do. Creating a tenant is an
//  admin act, so it uses an admin connection.
//
//  Prints the account API key ONCE — only its hash is stored, so save it.
// ────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";
import pkg from "pg";

const { Client } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
const EMAIL = process.env.TENANT_EMAIL;
const NAME = process.env.TENANT_NAME ?? "Atleta";
const MCP_URL = process.env.MCP_URL ?? "https://dashboard-treino-zeroventunos-projects.vercel.app/api/mcp";
const APP_URL = process.env.APP_URL ?? "https://trakdash.vercel.app/app";

if (!DATABASE_URL || !EMAIL) {
  console.error("Set DATABASE_URL (product pooler) and TENANT_EMAIL. Optional: TENANT_NAME.");
  process.exit(1);
}

const isLocal = DATABASE_URL.includes("localhost") || DATABASE_URL.includes("127.0.0.1");
const client = new Client({
  connectionString: DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});
await client.connect();

try {
  // Fail with the fix rather than a bare "permission denied for table tenants"
  // three queries later, mid-transaction.
  const { rows: perm } = await client.query(
    "select current_user, has_table_privilege('app.tenants','insert') as can_insert",
  );
  if (!perm[0].can_insert) {
    console.error(
      `Conectado como "${perm[0].current_user}", que não pode criar tenants.\n` +
        "Use a connection string do usuário postgres (Supabase → Project Settings →\n" +
        "Database → Connection string → pooler), não a do app_writer.\n" +
        "Lembre de URL-encodar a senha: @ vira %40, ! vira %21.",
    );
    process.exit(1);
  }

  const existing = await client.query("select id from app.tenants where email=$1", [EMAIL]);
  if (existing.rows.length) {
    console.error(`Tenant ${EMAIL} already exists (${existing.rows[0].id}). Aborting.`);
    process.exit(1);
  }

  await client.query("begin");

  const apiKey = "trak_" + randomBytes(24).toString("hex");
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  const { rows } = await client.query(
    "insert into app.tenants (email, status, plan, api_key_hash) values ($1,'trialing','free',$2) returning id",
    [EMAIL, apiKeyHash],
  );
  const tenantId = rows[0].id;

  // starter profile — the coach refines it via set_profile during discovery
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
  await client.query(
    "insert into profiles (tenant_id, athlete, mode) values ($1,$2,'race') on conflict (tenant_id) do nothing",
    [tenantId, NAME],
  );

  await client.query("commit");

  const line = "─".repeat(56);
  console.log("\n✅ Tenant criado.");
  console.log("tenant_id:", tenantId, "· email:", EMAIL);
  console.log("\n" + line);
  console.log("ENVIE ISTO PARA O ATLETA:");
  console.log(line);
  console.log(`Bem-vindo ao TRAK, ${NAME}! 🏊🚴🏃\n`);
  console.log("1) No Claude Desktop → Settings → Connectors → Add custom connector:");
  console.log("     Name: TRAK Coach");
  console.log(`     URL:  ${MCP_URL}?key=${apiKey}`);
  console.log("   Reinicie o app. As ferramentas do coach aparecem.\n");
  console.log("2) Seu painel (guarde o link):");
  console.log(`     ${APP_URL}?key=${apiKey}\n`);
  console.log("3) Peça ao coach: \"liste meus aparelhos e o que cada um mede\" para ele");
  console.log("   configurar seu perfil, e comece registrando o check-in de hoje.");
  console.log(line);
  console.log(`⚠ Chave da conta (mostrada só uma vez): ${apiKey}`);
  console.log(line + "\n");
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("Falhou, rollback:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
