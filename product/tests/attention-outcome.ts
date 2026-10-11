// O desfecho de um alerta: validação do que vem do navegador, ordenação da fila,
// e a conferência de que o código e o banco falam das mesmas listas.
// Rode com:  npx tsx product/tests/attention-outcome.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTE_MAX, OUTCOMES, REASONS, cleanNote, daysAgo, parseOutcomeInput, sinkLeft,
  type LatestOutcome,
} from "../../lib/attention-outcome";
import { LOCALES, translator, type TKey } from "../../lib/i18n";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};
const code = (b: Parameters<typeof parseOutcomeInput>[0]) => {
  const r = parseOutcomeInput(b);
  return r.ok ? "ok" : r.code;
};

// ── parseOutcomeInput ───────────────────────────────────────────────────────
ck("parse: 'contatado' sem motivo passa", code({ outcome: "contacted" }) === "ok");
ck("parse: 'ficou' sem motivo passa", code({ outcome: "stayed", note: "voltou a treinar" }) === "ok");
ck("parse: 'saiu' com motivo passa", code({ outcome: "left", reason: "price" }) === "ok");
ck("parse: 'saiu' SEM motivo é recusado", code({ outcome: "left" }) === "reason_required");
ck("parse: 'saiu' com motivo vazio é recusado", code({ outcome: "left", reason: "" }) === "reason_required");
ck("parse: motivo fora da lista é recusado", code({ outcome: "left", reason: "bad-reason" }) === "bad_reason");
ck("parse: motivo em 'ficou' é recusado (não é descartado em silêncio)", code({ outcome: "stayed", reason: "price" }) === "reason_not_allowed");
ck("parse: desfecho desconhecido / ausente / tipo errado", code({ outcome: "quit" }) === "bad_outcome" && code({}) === "bad_outcome" && code(null) === "bad_outcome" && code({ outcome: 1 }) === "bad_outcome");
{
  const r = parseOutcomeInput({ outcome: "left", reason: "health", note: "  pediu pausa \n até dezembro  " });
  ck("parse: nota é limpa e o valor devolvido é o normalizado",
    r.ok && r.value.note === "pediu pausa até dezembro" && r.value.reason === "health" && r.value.outcome === "left", JSON.stringify(r));
}
{
  const r = parseOutcomeInput({ outcome: "contacted", note: "   " });
  ck("parse: nota só com espaços vira null", r.ok && r.value.note === null);
}

// ── cleanNote ───────────────────────────────────────────────────────────────
ck("note: tira caracteres de controle", cleanNote("a\u0000b\u0007c\td") === "a b c d", JSON.stringify(cleanNote("a\u0000b\u0007c\td")));
ck("note: corta em 280", (cleanNote("x".repeat(500)) ?? "").length === NOTE_MAX);
ck("note: não-string → null", cleanNote(42) === null && cleanNote(undefined) === null);

// ── sinkLeft ────────────────────────────────────────────────────────────────
{
  const row = (id: string) => ({ tenant_id: id });
  const ev = (outcome: LatestOutcome["outcome"]): LatestOutcome => ({ outcome, reason: outcome === "left" ? "price" : null, note: null, at: "2026-10-01T10:00:00Z", by: null });
  const list = [row("a"), row("b"), row("c"), row("d")];

  const asRecord = sinkLeft(list, { b: ev("left"), c: ev("stayed") });
  ck("sink: quem saiu desce, o resto mantém a ordem", asRecord.map((r) => r.tenant_id).join("") === "acdb", asRecord.map((r) => r.tenant_id).join(""));

  const asMap = sinkLeft(list, new Map([["a", ev("left")], ["c", ev("left")]]));
  ck("sink: aceita Map; vários que saíram mantêm a ordem entre si", asMap.map((r) => r.tenant_id).join("") === "bdac", asMap.map((r) => r.tenant_id).join(""));

  ck("sink: sem desfechos, nada muda", sinkLeft(list, {}).map((r) => r.tenant_id).join("") === "abcd");
  ck("sink: não altera a lista de entrada", list.map((r) => r.tenant_id).join("") === "abcd");
  ck("sink: 'contatado' e 'ficou' não descem", sinkLeft(list, { a: ev("contacted"), b: ev("stayed") }).map((r) => r.tenant_id).join("") === "abcd");
}

// ── daysAgo ─────────────────────────────────────────────────────────────────
ck("daysAgo: mesmo dia = 0", daysAgo("2026-10-11T08:00:00Z", "2026-10-11") === 0);
ck("daysAgo: 3 dias", daysAgo("2026-10-08T23:30:00Z", "2026-10-11") === 3);
ck("daysAgo: nunca negativo", daysAgo("2026-10-12T00:00:00Z", "2026-10-11") === 0);
ck("daysAgo: data inválida não quebra", daysAgo("nope", "2026-10-11") === 0);

// ── código e banco falam das mesmas listas ──────────────────────────────────
{
  const sql = readFileSync(join(__dirname, "..", "add-attention-outcomes.sql"), "utf8");
  const listAfter = (re: RegExp) => {
    const m = sql.match(re);
    return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort() : [];
  };
  const sqlOutcomes = listAfter(/outcome\s+text not null check \(outcome in \(([^)]*)\)/);
  const sqlReasons = listAfter(/check \(reason in \(([\s\S]*?)\)\s*\)/);
  const same = (a: readonly string[], b: string[]) => a.length === b.length && [...a].sort().every((v, i) => v === b[i]);

  ck("sql: CHECK de outcome == OUTCOMES", same(OUTCOMES, sqlOutcomes), `${sqlOutcomes} ≠ ${[...OUTCOMES]}`);
  ck("sql: CHECK de reason == REASONS", same(REASONS, sqlReasons), `${sqlReasons} ≠ ${[...REASONS]}`);
  ck("sql: ON DELETE CASCADE nos dois vínculos de dono (RGPD)",
    /agency_id\s+uuid not null references app\.agencies\(id\)\s+on delete cascade/.test(sql) &&
      /tenant_id\s+uuid not null references app\.tenants\(id\)\s+on delete cascade/.test(sql));
  ck("sql: app_writer só recebe select e insert", /grant select, insert on app\.attention_outcomes to app_writer/.test(sql) && !/grant[^;]*(update|delete)[^;]*attention_outcomes/i.test(sql));
}

// ── os textos existem nos 5 idiomas (o cast `as TKey` não é checado pelo tsc) ─
{
  const keys: string[] = [
    ...OUTCOMES.map((o) => `agency.outcome.${o}`),
    ...OUTCOMES.map((o) => `agency.outcome.chip.${o}`),
    ...REASONS.map((r) => `agency.reason.${r}`),
  ];
  const missing: string[] = [];
  for (const l of LOCALES) {
    const tr = translator(l);
    for (const k of keys) {
      const v = tr(k as TKey);
      if (!v || v === k) missing.push(`${l}:${k}`);
    }
  }
  ck("i18n: todo desfecho, chip e motivo tem texto em pt/en/it/es/fr", missing.length === 0, missing.slice(0, 6).join(", "));
}

console.log(fail === 0 ? "\ntudo certo" : `\n${fail} falha(s)`);
process.exit(fail === 0 ? 0 : 1);
