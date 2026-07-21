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
  else bad(`no pooler o usuário precisa ser "postgres.<project-ref>", não "${user}" — é exatamente o que o 28P01 reclamou`);
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
