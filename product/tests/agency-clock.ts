// O dia da assessoria — o mesmo instante virando datas diferentes.
// Rode com:  npx tsx product/tests/agency-clock.ts
import {
  DEFAULT_TIMEZONE, isTimezone, resolveTimezone, timezoneNames, todayInZone,
} from "../../lib/agency-clock";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

// 23:30 UTC: a hora em que o painel errava. Em Roma já é o dia seguinte, em São
// Paulo ainda não é. Um instante, duas datas — é o caso inteiro do produto.
const NOITE = new Date("2026-08-18T23:30:00Z");

// ── O MESMO INSTANTE NÃO É O MESMO DIA ─────────────────────────────────────
ck("em UTC ainda e dia 18", todayInZone("UTC", NOITE) === "2026-08-18", todayInZone("UTC", NOITE));
ck("na frente do UTC ja e dia 19", todayInZone("Europe/Rome", NOITE) === "2026-08-19", todayInZone("Europe/Rome", NOITE));
ck("atras do UTC continua dia 18",
  todayInZone("America/Sao_Paulo", NOITE) === "2026-08-18", todayInZone("America/Sao_Paulo", NOITE));
ck("o dono na Italia e o atleta no Brasil estao em dias diferentes",
  todayInZone("Europe/Rome", NOITE) !== todayInZone("America/Sao_Paulo", NOITE));

// O outro lado da meia-noite: 01:30 UTC, quando é o Brasil que fica para trás.
const MADRUGADA = new Date("2026-08-19T01:30:00Z");
ck("as 01:30Z Roma e Brasil tambem discordam",
  todayInZone("Europe/Rome", MADRUGADA) === "2026-08-19" &&
  todayInZone("America/Sao_Paulo", MADRUGADA) === "2026-08-18",
  `${todayInZone("Europe/Rome", MADRUGADA)} / ${todayInZone("America/Sao_Paulo", MADRUGADA)}`);

// Extremos do fuso: a mesma hora pode ser dois dias de distância, e o helper não
// pode ter nada de "±1" embutido.
ck("dois dias de diferenca entre as pontas do mundo",
  todayInZone("Pacific/Kiritimati", NOITE) === "2026-08-19" &&
  todayInZone("Pacific/Niue", NOITE) === "2026-08-18",
  `${todayInZone("Pacific/Kiritimati", NOITE)} / ${todayInZone("Pacific/Niue", NOITE)}`);

// ── NO MEIO DO DIA TODO MUNDO CONCORDA ─────────────────────────────────────
// Se a conversão estivesse deslocando o dia sempre, isto quebraria.
const MEIO_DIA = new Date("2026-08-18T12:00:00Z");
ck("ao meio-dia UTC os tres fusos batem",
  todayInZone("UTC", MEIO_DIA) === "2026-08-18" &&
  todayInZone("Europe/Rome", MEIO_DIA) === "2026-08-18" &&
  todayInZone("America/Sao_Paulo", MEIO_DIA) === "2026-08-18");

// ── HORÁRIO DE VERÃO É DA BIBLIOTECA, NÃO NOSSO ────────────────────────────
// Roma é UTC+1 no inverno e UTC+2 no verão. O MESMO horário UTC — 22:30 — cai
// em dias diferentes conforme o mês. Aritmética de offset fixo erraria metade
// do ano, e é por isso que a conta é do Intl e não nossa.
ck("inverno em Roma: 22:30Z ainda e o mesmo dia",
  todayInZone("Europe/Rome", new Date("2026-01-15T22:30:00Z")) === "2026-01-15",
  todayInZone("Europe/Rome", new Date("2026-01-15T22:30:00Z")));
ck("verao em Roma: o mesmo 22:30Z ja virou o dia",
  todayInZone("Europe/Rome", new Date("2026-07-15T22:30:00Z")) === "2026-07-16",
  todayInZone("Europe/Rome", new Date("2026-07-15T22:30:00Z")));

// ── A DATA SAI NO FORMATO QUE O PAINEL INTEIRO USA ─────────────────────────
// Todo o resto compara string com string ("YYYY-MM-DD"); um mês sem zero à
// esquerda ordenaria errado e não bateria com nenhuma linha do banco.
ck("mes e dia vem com zero a esquerda",
  todayInZone("UTC", new Date("2026-01-05T12:00:00Z")) === "2026-01-05",
  todayInZone("UTC", new Date("2026-01-05T12:00:00Z")));
ck("a virada do ano nao perde o ano",
  todayInZone("Europe/Rome", new Date("2026-12-31T23:30:00Z")) === "2027-01-01",
  todayInZone("Europe/Rome", new Date("2026-12-31T23:30:00Z")));
ck("o formato e sempre YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(todayInZone("Australia/Darwin", NOITE)));
// Meia hora de offset existe (Darwin é UTC+9:30) e não é arredondável: meia
// hora antes ainda é ontem, meia hora depois já é hoje.
ck("fuso de meia hora: 14:15Z ainda nao virou",
  todayInZone("Australia/Darwin", new Date("2026-08-18T14:15:00Z")) === "2026-08-18",
  todayInZone("Australia/Darwin", new Date("2026-08-18T14:15:00Z")));
ck("fuso de meia hora: 14:45Z ja virou",
  todayInZone("Australia/Darwin", new Date("2026-08-18T14:45:00Z")) === "2026-08-19",
  todayInZone("Australia/Darwin", new Date("2026-08-18T14:45:00Z")));

// ── NOME DESCONHECIDO É RECUSADO, NÃO GUARDADO ─────────────────────────────
// A regra da casa: recusar vale mais que fingir. Um fuso que ninguém resolve
// não quebra — ele envenena silenciosamente toda data do painel.
ck("fuso inventado e recusado", isTimezone("Europe/Rime") === false);
ck("offset nao e fuso", isTimezone("+01:00") === false);
ck("vazio nao e fuso", isTimezone("") === false);
ck("nulo nao e fuso", isTimezone(null) === false);
ck("numero nao e fuso", isTimezone(42) === false);
// O Intl aceitaria minúsculas; nós não — o que fica guardado tem que ser a
// grafia canônica, senão duas linhas iguais deixam de ser comparáveis.
ck("caixa errada e recusada", isTimezone("europe/rome") === false);
ck("nome de verdade passa", isTimezone("Europe/Rome") === true);
ck("o outro lado do mundo tambem passa", isTimezone("America/Sao_Paulo") === true);

// A lista do runtime é a autoridade, não o que o Intl consegue formatar. A ICU
// lista UM dos dois nomes da Índia como canônico (hoje "Asia/Calcutta") e
// formata os dois; gravar o apelido faria duas assessorias no mesmo fuso
// guardarem strings diferentes e deixarem de ser comparáveis.
const apelido = ["Asia/Kolkata", "Asia/Calcutta"].find((n) => !timezoneNames().includes(n));
ck("apelido fora da lista e recusado, mesmo o Intl aceitando",
  apelido !== undefined && isTimezone(apelido) === false, String(apelido));

// ── UTC É O CHÃO ───────────────────────────────────────────────────────────
// `Intl.supportedValuesOf` NÃO lista "UTC" (é apelido de Etc/UTC, e a lista é
// só de nomes canônicos). Sem o cuidado no helper, o padrão da própria coluna
// seria reprovado pela própria validação.
ck("UTC e o padrao", DEFAULT_TIMEZONE === "UTC");
ck("UTC passa na validacao mesmo nao estando na lista do Intl", isTimezone("UTC") === true);
ck("UTC aparece na lista do seletor", timezoneNames().includes("UTC"));
ck("a lista tem os fusos de verdade tambem",
  timezoneNames().includes("Europe/Rome") && timezoneNames().includes("America/Sao_Paulo"));
ck("a lista vem ordenada",
  JSON.stringify(timezoneNames()) === JSON.stringify([...timezoneNames()].sort()));

ck("fuso invalido cai em UTC", resolveTimezone("Europe/Rime") === "UTC");
ck("assessoria sem fuso gravado cai em UTC", resolveTimezone(null) === "UTC");
ck("indefinido cai em UTC", resolveTimezone(undefined) === "UTC");
ck("fuso valido e devolvido inteiro", resolveTimezone("Europe/Rome") === "Europe/Rome");

// E a queda tem que ser a data de UTC, não um erro e não uma data qualquer:
// antes de a migração rodar, `timezone` chega nulo e o painel precisa seguir
// exatamente como estava.
ck("data de fuso invalido e a data de UTC", todayInZone("Europe/Rime", NOITE) === todayInZone("UTC", NOITE));
ck("data de fuso nulo e a data de UTC", todayInZone(null, NOITE) === "2026-08-18", todayInZone(null, NOITE));

// ── PURO: SEM RELÓGIO ESCONDIDO ────────────────────────────────────────────
// O instante é parâmetro. Se algum dia alguém trocar por um `new Date()` lá
// dentro, isto para de passar e o teste inteiro perde o chão.
ck("o mesmo instante da sempre a mesma resposta",
  todayInZone("Europe/Rome", NOITE) === todayInZone("Europe/Rome", NOITE));
ck("sem instante, usa agora e ainda assim responde",
  /^\d{4}-\d{2}-\d{2}$/.test(todayInZone("Europe/Rome")));

console.log(fail === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
