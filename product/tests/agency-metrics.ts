// Placar por profissional. Rode com:  npx tsx product/tests/agency-metrics.ts
import { scoreCoach, coachCost, rankBy, agencyRollup, type StaffInfo } from "../../lib/agency-metrics";
import type { Assessed, AthleteState } from "../../lib/retention";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

/** Só os campos que o placar lê; o resto de Assessed não entra na conta. */
const ath = (state: AthleteState, value: number | null): Assessed =>
  ({ state, monthly_value: value == null ? null : String(value) } as Assessed);

const COACH: StaffInfo = { id: "c1", name: "Luca", role: "coach" };

// ── Contagem e receita ─────────────────────────────────────────────────────
const book = [
  ath("active", 200), ath("active", 200), ath("at_risk", 150),
  ath("inactive", 100), ath("new", 250), ath("active", null),
];
const s = scoreCoach(COACH, book);
ck("conta a carteira inteira", s.athletes === 6, String(s.athletes));
ck("separa os estados", s.active === 3 && s.atRisk === 1 && s.inactive === 1 && s.newAthletes === 1);
ck("receita soma só quem tem preço", s.revenue === 900, String(s.revenue));
ck("aluno sem preço é contado a parte", s.unpriced === 1, String(s.unpriced));
ck("receita em risco = em risco + inativo", s.revenueAtRisk === 250, String(s.revenueAtRisk));
ck("saude = fatia nao doente", s.healthy === 0.67, String(s.healthy));

// ── Custo: os tres modelos ─────────────────────────────────────────────────
ck("pct tira do faturamento", coachCost({ ...COACH, payModel: "pct", payValue: 60 }, 1000, 5) === 600);
ck("por aluno multiplica a carteira", coachCost({ ...COACH, payModel: "per_athlete", payValue: 30 }, 1000, 5) === 150);
ck("salario ignora carteira e receita", coachCost({ ...COACH, payModel: "salary", payValue: 3000 }, 1000, 5) === 3000);
ck("por aluno conta ate quem nao tem preco",
  coachCost({ ...COACH, payModel: "per_athlete", payValue: 30 }, 900, 6) === 180);

// ── A regra que mais importa: desconhecido NUNCA vira zero ─────────────────
ck("sem modelo, custo e null", coachCost(COACH, 1000, 5) === null);
ck("sem modelo, margem e null", s.margin === null, String(s.margin));
ck("sem modelo, custo por aluno e null", s.costPerAthlete === null);
ck("modelo sem valor nao calcula", coachCost({ ...COACH, payModel: "pct" }, 1000, 5) === null);

const paid = scoreCoach({ ...COACH, payModel: "pct", payValue: 60 }, book);
ck("margem = receita - custo", paid.cost === 540 && paid.margin === 360, `${paid.cost}/${paid.margin}`);
ck("custo por aluno divide pela carteira inteira", paid.costPerAthlete === 90, String(paid.costPerAthlete));

// Salário fixo: custo/aluno CAI conforme a carteira enche — é isso que amarra
// margem com capacidade, e o placar tem que mostrar.
const sal = (n: number) =>
  scoreCoach({ ...COACH, payModel: "salary", payValue: 3000 }, Array.from({ length: n }, () => ath("active", 200)));
ck("salario: custo/aluno cai enchendo a carteira",
  sal(10).costPerAthlete === 300 && sal(30).costPerAthlete === 100,
  `${sal(10).costPerAthlete} → ${sal(30).costPerAthlete}`);
ck("salario: margem vira do vermelho pro azul",
  sal(10).margin! < 0 && sal(30).margin! > 0,
  `${sal(10).margin} → ${sal(30).margin}`);

// ── Capacidade ─────────────────────────────────────────────────────────────
const loaded = scoreCoach({ ...COACH, maxAthletes: 4 }, book);
ck("ocupacao pode passar de 1 (estourado e informacao)", loaded.load === 1.5, String(loaded.load));
ck("sem alvo declarado, ocupacao e null", s.load === null);

// ── Casos de borda ─────────────────────────────────────────────────────────
const empty = scoreCoach(COACH, []);
ck("profissional sem carteira ainda aparece", empty.athletes === 0 && empty.revenue === 0);
ck("carteira vazia e saudavel, nao doente", empty.healthy === 1, String(empty.healthy));
ck("sem nome, usa o papel", scoreCoach({ id: "x", name: null, role: "physio" }, []).name === "physio");
ck("nome so com espacos tambem cai no papel",
  scoreCoach({ id: "x", name: "   ", role: "nutritionist" }, []).name === "nutritionist");

// ── Ranking: desconhecido vai pro FIM, nao pro fundo ───────────────────────
const rows = [
  scoreCoach({ id: "a", name: "Ana", role: "coach", payModel: "pct", payValue: 50 }, [ath("active", 100)]),
  scoreCoach({ id: "b", name: "Bruno", role: "coach" }, [ath("active", 900)]),
  scoreCoach({ id: "c", name: "Caio", role: "coach", payModel: "pct", payValue: 50 }, [ath("active", 400)]),
];
const byMargin = rankBy(rows, "margin");
ck("ranking por margem: maior primeiro", byMargin[0].name === "Caio", byMargin.map((r) => r.name).join(","));
ck("margem desconhecida vai para o fim, nao para o fundo",
  byMargin[byMargin.length - 1].name === "Bruno",
  byMargin.map((r) => `${r.name}:${r.margin}`).join(" "));
ck("trocar a metrica troca a ordem", rankBy(rows, "revenue")[0].name === "Bruno");

// ── Rollup: nao finge total completo ───────────────────────────────────────
const partial = agencyRollup(rows);
ck("com um profissional sem modelo, custo total e null", partial.cost === null && partial.margin === null);
ck("e a UI sabe disso", partial.costKnown === false);
ck("receita total soma mesmo assim", partial.revenue === 1400, String(partial.revenue));

const allPaid = agencyRollup([rows[0], rows[2]]);
ck("todos com modelo, total fecha", allPaid.costKnown === true && allPaid.cost === 250, String(allPaid.cost));
ck("margem total = receita - custo", allPaid.margin === 250, String(allPaid.margin));
ck("assessoria sem ninguem nao afirma custo", agencyRollup([]).costKnown === false);

console.log(fail === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
