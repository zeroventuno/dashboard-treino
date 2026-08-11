// Sugestão de alocação. Rode com:  npx tsx product/tests/suggest-coach.ts
import { suggestCoach, bestSuggestion, marginalCost, specialtyFit, type Candidate } from "../../lib/suggest-coach";
import type { StaffInfo } from "../../lib/agency-metrics";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

const coach = (id: string, over: Partial<StaffInfo> = {}): StaffInfo =>
  ({ id, name: id, role: "coach", ...over });
const cand = (s: StaffInfo, athletes: number, revenue = athletes * 200): Candidate => ({ staff: s, athletes, revenue });

const TRI = { sports: ["swim", "bike", "run"], monthlyValue: 200 };

// ── Custo marginal: o achado que move a alocação ───────────────────────────
ck("assalariado: aluno a mais custa ZERO", marginalCost(coach("a", { payModel: "salary", payValue: 3000 }), 200) === 0);
ck("por aluno: custa o valor fixo", marginalCost(coach("a", { payModel: "per_athlete", payValue: 30 }), 200) === 30);
ck("percentual: custa a fatia DAQUELE aluno", marginalCost(coach("a", { payModel: "pct", payValue: 60 }), 200) === 120);
ck("percentual de aluno sem preco nao inventa custo",
  marginalCost(coach("a", { payModel: "pct", payValue: 60 }), null) === 0);
ck("sem modelo: desconhecido, nao zero", marginalCost(coach("a"), 200) === null);

// ── Especialidade: vazio e "sem restricao", nunca "nenhuma" ────────────────
ck("sem esportes declarados = sem sinal (null, nao 0)", specialtyFit(["run"], []) === null);
ck("sem esportes declarados (undefined) = sem sinal", specialtyFit(["run"], undefined) === null);
ck("aluno sem modalidade conhecida = sem sinal", specialtyFit([], ["run"]) === null);
ck("cobertura total = 1", specialtyFit(["swim", "run"], ["swim", "run", "bike"]) === 1);
ck("cobertura parcial", specialtyFit(["swim", "run"], ["run"]) === 0.5);
ck("nenhuma em comum = 0", specialtyFit(["swim"], ["run"]) === 0);

// ── Especialidade pesa mais que dinheiro ───────────────────────────────────
const tri = coach("Tri", { sports: ["swim", "bike", "run"], payModel: "pct", payValue: 60 });
const runner = coach("SóCorrida", { sports: ["run"], payModel: "salary", payValue: 3000 });
let r = suggestCoach(TRI, [cand(tri, 10), cand(runner, 10)]);
ck("triatleta vai pro tri, mesmo com o outro sendo marginalmente gratis",
  r[0].staffId === "Tri", r.map((x) => `${x.staffId}:${x.score}`).join(" "));

// ── Equilíbrio de carteiras ────────────────────────────────────────────────
const a = coach("Leve", { sports: ["run"] });
const b = coach("Cheio", { sports: ["run"] });
r = suggestCoach({ sports: ["run"], monthlyValue: 200 }, [cand(a, 5), cand(b, 40)]);
ck("carteira mais leve ganha quando o resto empata", r[0].staffId === "Leve");
ck("e o motivo aparece", r[0].reasons.includes("light_book"), r[0].reasons.join(","));
ck("a carteira pesada tambem e explicada",
  r.find((x) => x.staffId === "Cheio")!.reasons.includes("heavy_book"));

// ── Capacidade ─────────────────────────────────────────────────────────────
const full = coach("Lotado", { sports: ["run"], maxAthletes: 20 });
const room = coach("ComVaga", { sports: ["run"], maxAthletes: 40 });
r = suggestCoach({ sports: ["run"], monthlyValue: 200 }, [cand(full, 20), cand(room, 20)]);
ck("quem tem vaga ganha de quem lotou", r[0].staffId === "ComVaga");
ck("lotado e marcado como cheio", r.find((x) => x.staffId === "Lotado")!.reasons.includes("full"));
ck("lotado nao 'cabe'", r.find((x) => x.staffId === "Lotado")!.fits === false);
ck("estourado e marcado como estourado",
  suggestCoach({ sports: ["run"], monthlyValue: 200 }, [cand(full, 25)])[0].reasons.includes("over"));

// ── bestSuggestion: só recomenda quem cabe ─────────────────────────────────
// Carteira vazia pontua alto em equilíbrio, mas a especialidade não bate.
const wrong = coach("Nadador", { sports: ["swim"] });
const okBusy = coach("Corrida", { sports: ["run"] });
r = suggestCoach({ sports: ["run"], monthlyValue: 200 }, [cand(wrong, 0), cand(okBusy, 30)]);
const best = bestSuggestion(r);
ck("nao recomenda especialidade incompativel, mesmo liderando a nota",
  best?.staffId === "Corrida",
  `lider=${r[0].staffId} recomendado=${best?.staffId}`);
ck("incompativel nao 'cabe'", r.find((x) => x.staffId === "Nadador")!.fits === false);

// Ninguém serve → não inventa recomendação.
ck("sem ninguem que caiba, nao recomenda",
  bestSuggestion(suggestCoach({ sports: ["swim"], monthlyValue: 200 }, [cand(coach("R", { sports: ["run"] }), 3)])) === null);

// Mas a lista continua visível para a pessoa decidir.
ck("a lista continua completa mesmo assim",
  suggestCoach({ sports: ["swim"], monthlyValue: 200 }, [cand(coach("R", { sports: ["run"] }), 3)]).length === 1);

// ── Bordas ─────────────────────────────────────────────────────────────────
ck("sem candidatos = lista vazia", suggestCoach(TRI, []).length === 0);
ck("sem candidatos = sem recomendacao", bestSuggestion([]) === null);
ck("assessoria de um treinador so: ele e a resposta",
  bestSuggestion(suggestCoach(TRI, [cand(coach("Unico"), 12)]))?.staffId === "Unico");
ck("aluno novo sem modalidade conhecida ainda recebe sugestao",
  bestSuggestion(suggestCoach({ sports: [], monthlyValue: null }, [cand(a, 5), cand(b, 40)]))?.staffId === "Leve");
ck("nome vazio cai no papel",
  suggestCoach(TRI, [cand({ id: "x", name: "  ", role: "physio" }, 1)])[0].name === "physio");

// Empate de custo não pode diferenciar ninguém por custo.
const t1 = coach("A", { sports: ["run"], payModel: "per_athlete", payValue: 30 });
const t2 = coach("B", { sports: ["run"], payModel: "per_athlete", payValue: 30 });
const tie = suggestCoach({ sports: ["run"], monthlyValue: 200 }, [cand(t1, 10), cand(t2, 10)]);
ck("custo igual: notas iguais", tie[0].score === tie[1].score, `${tie[0].score} vs ${tie[1].score}`);

console.log(fail === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
