// ────────────────────────────────────────────────────────────────────────────
//  check-url.mjs — why is DATABASE_URL being rejected?
//
//  Parses the connection string exactly like `pg` does and reports what the
//  server will actually receive. Never prints the password, only its shape.
//
//    $env:DATABASE_URL = '...'
//    node check-url.mjs
// ────────────────────────────────────────────────────────────────────────────

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("DATABASE_URL não está definida nesta sessão do terminal.");
  console.error("PowerShell:  $env:DATABASE_URL = '...'   (aspas SIMPLES)");
  process.exit(1);
}

const ok = (m) => console.log("  ✅ " + m);
const bad = (m) => console.log("  ❌ " + m);
const warn = (m) => console.log("  ⚠  " + m);

let u;
try {
  u = new URL(raw);
} catch {
  bad("A string não é uma URL válida — provavelmente falta URL-encodar a senha.");
  process.exit(1);
}

const user = decodeURIComponent(u.username);
const pass = decodeURIComponent(u.password);

console.log("\nComo o driver está lendo a sua connection string:\n");
console.log(`  usuário : ${user}`);
console.log(`  host    : ${u.hostname}`);
console.log(`  porta   : ${u.port || "(padrão 5432)"}`);
console.log(`  banco   : ${u.pathname.replace(/^\//, "") || "(vazio)"}`);
console.log(`  senha   : ${pass.length} caracteres (não exibida)\n`);

console.log("Verificações:");

// 1. Pooler requires the project ref in the username.
const isPooler = u.hostname.includes("pooler.supabase.com");
if (isPooler) {
  if (/^postgres\.[a-z0-9]{16,}$/.test(user)) ok(`usuário no formato do pooler (postgres.<ref>)`);
  else bad(`no pooler o usuário precisa ser "postgres.<project-ref>", não "${user}"`);
  // NB: a 28P01 always names `postgres`, never `postgres.<ref>` — the pooler
  // uses the ref to route and then connects downstream as `postgres`. So that
  // message says nothing about whether the ref is present; don't read it as
  // evidence either way.
} else if (u.hostname.startsWith("db.")) {
  warn("host de conexão DIRETA: só resolve em IPv6, costuma dar ENOTFOUND. Use o pooler.");
} else {
  warn(`host inesperado: ${u.hostname}`);
}

// 2. Port.
if (isPooler && u.port !== "6543" && u.port !== "5432") {
  warn(`porta ${u.port}: o pooler usa 6543 (transaction) ou 5432 (session)`);
}

// 3. The classic trap: characters that must be percent-encoded in the userinfo.
const needsEncoding = [...new Set(pass.split("").filter((c) => "@:/?#[]!$&'()*+,;= ".includes(c)))];
if (needsEncoding.length) {
  warn(
    `a senha contém ${needsEncoding.map((c) => `"${c}"`).join(" ")} — ` +
      `se você colou esses caracteres crus, encode-os (@ → %40, ! → %21, # → %23, / → %2F, : → %3A)`,
  );
} else {
  ok("senha sem caracteres que exijam encoding");
}

// 4. A raw "@" in the password moves where the host starts, and the symptom is
//    exactly a wrong username — worth naming explicitly.
const atCount = (raw.match(/@/g) || []).length;
if (atCount > 1) {
  bad(`há ${atCount} "@" na string: o parser corta no último, então usuário/host saem errados. Encode o "@" da senha como %40.`);
}

if (!pass) bad("senha vazia depois do parse");
console.log("");

// A real connection attempt: the string can be perfectly well-formed and the
// password still be wrong, and that's the only way to tell the two apart.
console.log("Tentando conectar…");
const { default: pkg } = await import("pg");
const client = new pkg.Client({ connectionString: raw, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  const { rows } = await client.query(
    "select current_user, has_table_privilege('app.tenants','insert') as pode_criar_tenant",
  );
  ok(`conectado como "${rows[0].current_user}"`);
  if (rows[0].pode_criar_tenant) ok("pode criar tenants — provision.mjs vai funcionar");
  else bad("conectou, mas NÃO pode criar tenants: essa é a credencial do app_writer, não a do postgres");
} catch (e) {
  if (e.code === "28P01") {
    bad("senha rejeitada (28P01).");
    console.log(
      "\n     A string está bem formada, então sobra a senha em si. O erro nomeia\n" +
        '     "postgres" mesmo quando o ref está presente (o pooler roteia pelo ref\n' +
        "     e conecta como postgres), então isso NÃO indica falta do ref.\n\n" +
        "     Redefina em: Supabase → Project Settings → Database → Reset database\n" +
        "     password. Escolha só letras e números para evitar de vez o encoding.",
    );
  } else if (e.code === "ENOTFOUND") {
    bad(`host não resolve (${u.hostname}) — se for db.<ref>.supabase.co, é IPv6-only; use o pooler.`);
  } else {
    bad(`${e.code ?? ""} ${e.message}`);
  }
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
  console.log("");
}
