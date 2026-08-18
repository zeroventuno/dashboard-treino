// Os sinais diários — e, sobretudo, o que o gráfico faz com os dias que FALTAM.
// Rode com:  npx tsx product/tests/vitals.ts
import {
  MAX_RANGE_DAYS, buildDayGrid, hasVitals, prepareVitals, rollingMean, stableSeriesKeys,
} from "../../lib/vitals";
import type { Checkin } from "../../lib/types";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

const HOJE = "2026-03-31";

const c = (date: string, v: Partial<Checkin> = {}): Checkin => ({
  date, hrv: null, sleep_hours: null, readiness_score: null, body_battery: null,
  resting_hr: null, recommendation: null, notes: null,
  hydration_liters: null, whey_shakes: null, protein_grams_estimate: null, ...v,
});

const keys = (cs: Checkin[], m: Parameters<typeof prepareVitals>[1], d: number) =>
  prepareVitals(cs, m, d, HOJE).series.map((s) => s.def.key);

// ── A GRADE É DIÁRIA, NÃO É A LISTA DE LINHAS ──────────────────────────────
// `checkins` não tem linha nenhuma num dia pulado. Um gráfico alimentado direto
// do array desenha os dois vizinhos do buraco colados — o buraco some e a reta
// que passa por ele parece medição.
const esparso = [c("2026-03-01", { hrv: 70 }), c("2026-03-10", { hrv: 60 })];
const grade = buildDayGrid(esparso, 31, HOJE);
ck("a janela tem um dia por data, nao um por linha", grade.dates.length === 31, String(grade.dates.length));
ck("comeca onde o range manda", grade.dates[0] === "2026-03-01", grade.dates[0]);
ck("termina hoje", grade.dates[30] === HOJE, grade.dates[30]);
ck("o dia com check-in tem linha", grade.rows[0] !== null);
ck("o dia sem check-in existe na grade, vazio", grade.rows[1] === null);

// A janela termina HOJE mesmo que o atleta tenha parado de registrar: quem
// parou precisa ver que parou, não um gráfico que acaba junto com a disciplina.
ck("a janela vai ate hoje mesmo com check-in antigo",
  buildDayGrid([c("2026-03-05", { hrv: 70 })], 10, HOJE).endISO === HOJE);
ck("um check-in no futuro estica o fim da janela",
  buildDayGrid([c("2026-04-02", { hrv: 70 })], 10, HOJE).endISO === "2026-04-02");

// ── DIA SEM LEITURA NÃO É ZERO ─────────────────────────────────────────────
ck("media movel ignora o vazio, nao soma zero",
  rollingMean([9, null, 9, null, 9], 7, 3)[4] === 9,
  String(rollingMean([9, null, 9, null, 9], 7, 3)[4]));
ck("com leituras de menos, nao existe media",
  rollingMean([10, null, null, null, null, null, null], 7, 3)[6] === null);
ck("com o minimo de leituras, existe", rollingMean([10, 20, 30, null, null, null, null], 7, 3)[6] === 20);

// ── E A LINHA PRECISA PARTIR NO BURACO ─────────────────────────────────────
// Três leituras, dez dias de silêncio, três leituras. Uma média móvel que
// atravessasse isso estaria afirmando dez dias que ninguém mediu.
const buraco = [80, 80, 80, ...Array<null>(10).fill(null), 80, 80, 80];
const m = rollingMean(buraco, 7, 3);
ck("antes do buraco a media existe", m[6] === 80, String(m[6]));
ck("a linha PARTE quando a janela esvazia", m[7] === null, String(m[7]));
ck("e segue partida no meio do buraco", m[10] === null && m[13] === null);
ck("volta so quando as leituras voltam", m[14] === null && m[15] === 80, `${m[14]} / ${m[15]}`);

// ── OS DIAS QUE FALTAM SÃO DESENHADOS, E CONTADOS ──────────────────────────
const doisDias = [c("2026-03-29", { hrv: 70 }), c(HOJE, { hrv: 72 })];
const sHrv = prepareVitals(doisDias, ["hrv"], 3, HOJE).series[0];
ck("o dia sem linha vira ponto vazio", sHrv.points[1].value === null);
ck("e ganha a marca de falta", sHrv.points[1].gap === 1);
ck("o dia com leitura nao ganha marca", sHrv.points[0].gap === null && sHrv.points[2].gap === null);
ck("faltas e leituras somam a janela", sHrv.logged + sHrv.missing === sHrv.points.length);
ck("conta 2 leituras e 1 falta", sHrv.logged === 2 && sHrv.missing === 1, `${sHrv.logged}/${sHrv.missing}`);
ck("a media da serie ignora o dia vazio", sHrv.mean === 71, String(sHrv.mean));
ck("o minimo nao vira zero", sHrv.min === 70, String(sHrv.min));

// Uma LINHA que existe mas não traz o campo é falta na mesma: o atleta registrou
// o sono e não a VFC, e a VFC daquele dia não foi medida.
const meioRegistro = [c("2026-03-30", { sleep_hours: 7 }), c(HOJE, { hrv: 70, sleep_hours: 7 })];
const sMeio = prepareVitals(meioRegistro, ["hrv", "sleep"], 2, HOJE).series[0];
ck("campo nulo numa linha existente conta como falta", sMeio.def.key === "hrv" && sMeio.points[0].gap === 1);
ck("a outra serie do mesmo dia continua cheia",
  prepareVitals(meioRegistro, ["hrv", "sleep"], 2, HOJE).series[1].missing === 0);

// ── PORTÃO 1: O QUE O ATLETA DECLAROU ──────────────────────────────────────
const completo = [c("2026-03-30", { hrv: 70, sleep_hours: 7, readiness_score: 80, body_battery: 60, resting_hr: 48 })];
ck("sem cinta de VFC, nao existe grafico de VFC",
  JSON.stringify(keys(completo, ["sleep", "readiness"], 30)) ===
    JSON.stringify(["sleep_hours", "readiness_score", "resting_hr"]),
  JSON.stringify(keys(completo, ["sleep", "readiness"], 30)));
ck("com tudo declarado, saem as cinco",
  keys(completo, ["hrv", "sleep", "readiness", "body_battery"], 30).length === 5);
ck("FC de repouso nao depende de flag nenhuma",
  JSON.stringify(keys(completo, [], 30)) === JSON.stringify(["resting_hr"]));

// ── PORTÃO 2: O QUE ELE REALMENTE REGISTROU ────────────────────────────────
// Declarar o aparelho não basta: um gráfico vazio é lido como número ruim ou
// como produto quebrado, nunca como "esse dado não existe".
ck("declarado mas nunca registrado nao vira grafico vazio",
  JSON.stringify(keys([c("2026-03-30", { hrv: 70 })], ["hrv", "sleep", "readiness", "body_battery"], 30)) ===
    JSON.stringify(["hrv"]));

// ── O BLOCO INTEIRO SÓ APARECE SE TIVER O QUE MOSTRAR ──────────────────────
ck("sem check-in nenhum, o bloco nao aparece", hasVitals([], ["hrv", "sleep"], HOJE) === false);
ck("so FC de repouso ja basta", hasVitals([c(HOJE, { resting_hr: 48 })], [], HOJE) === true);
ck("leitura velha demais nao conta", hasVitals([c("2024-01-01", { hrv: 70 })], ["hrv"], HOJE) === false);
ck("a decisao usa a janela mais larga do seletor", MAX_RANGE_DAYS === 182, String(MAX_RANGE_DAYS));

// ── O PAINEL NÃO SOME QUANDO O ATLETA TROCA O RANGE ────────────────────────
// A VFC existe (janeiro), mas não dentro de 30 dias. O painel fica e diz que
// não houve leitura — some seria pior: a grade dança embaixo do dedo.
const antigo = [c("2026-01-10", { hrv: 70 }), c("2026-01-11", { hrv: 71 }), c(HOJE, { resting_hr: 48 })];
const fixos = stableSeriesKeys(antigo, ["hrv"], HOJE);
ck("o conjunto de series vem da janela mais larga",
  JSON.stringify(fixos) === JSON.stringify(["hrv", "resting_hr"]), JSON.stringify(fixos));
const curto = prepareVitals(antigo, ["hrv"], 30, HOJE, fixos);
ck("num range curto o painel continua la", curto.series.length === 2, String(curto.series.length));
ck("e admite que nao houve leitura", curto.series[0].logged === 0 && curto.series[0].latest === null);

console.log(fail === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
