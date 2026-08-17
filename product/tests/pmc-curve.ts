// A curva de condicionamento, agora numa definição só.
// Rode com:  npx tsx product/tests/pmc-curve.ts
import { dailyTss, type TssSource } from "../../lib/pmc-curve";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

const w = (date: string, tss: number | null, status = "done", planned: number | null = null): TssSource =>
  ({ date, actual_tss: tss, planned_tss: planned, status } as TssSource);

// ── O básico ───────────────────────────────────────────────────────────────
ck("soma o dia", dailyTss([w("2026-01-05", 60), w("2026-01-05", 40)])["2026-01-05"] === 100);
ck("realizado ganha do planejado", dailyTss([w("2026-01-05", 60, "done", 90)])["2026-01-05"] === 60);
ck("sem realizado, usa o planejado", dailyTss([w("2026-01-05", null, "planned", 90)])["2026-01-05"] === 90);
ck("sem nenhum dos dois, o dia nao existe", dailyTss([w("2026-01-05", null, "planned")])["2026-01-05"] === undefined);

// ── REMARCAR NÃO PODE CONTAR DUAS VEZES ────────────────────────────────────
// Remarcar escreve DUAS linhas: a original riscada como `moved` e uma cópia
// `planned` na data nova. Contar as duas colocava o mesmo treino na curva duas
// vezes — o gráfico lia mais forma do que o atleta treinou, e a fadiga derivada
// dele lia mais ainda. O box semanal já tinha aprendido isso; a curva não.
const remarcado: TssSource[] = [
  w("2026-01-05", null, "moved", 80),   // original, riscada
  w("2026-01-07", null, "planned", 80), // cópia na data nova
];
const rem = dailyTss(remarcado);
ck("o dia de origem de um treino remarcado nao carrega carga", rem["2026-01-05"] === undefined, String(rem["2026-01-05"]));
ck("a carga vai para a data nova", rem["2026-01-07"] === 80, String(rem["2026-01-07"]));
ck("o treino conta UMA vez, nao duas",
  Object.values(rem).reduce((s, n) => s + n, 0) === 80,
  String(Object.values(rem).reduce((s, n) => s + n, 0)));

// ── Cancelado também sai ───────────────────────────────────────────────────
ck("cancelado nao carrega carga", dailyTss([w("2026-01-05", null, "cancelled", 70)])["2026-01-05"] === undefined);

// ── O que continua contando ────────────────────────────────────────────────
ck("pulado conta o planejado (falhou, mas estava no plano)",
  dailyTss([w("2026-01-05", null, "skipped", 50)])["2026-01-05"] === 50);
ck("extra conta (treinou de verdade)", dailyTss([w("2026-01-05", 45, "done")])["2026-01-05"] === 45);
ck("status ausente nao derruba a linha", dailyTss([{ date: "2026-01-05", actual_tss: 30, planned_tss: null } as TssSource])["2026-01-05"] === 30);

// Um dia com um remarcado e um treino de verdade mantém só o de verdade.
const misto = dailyTss([w("2026-01-05", null, "moved", 80), w("2026-01-05", 55, "done")]);
ck("num dia misto, so o que vale entra", misto["2026-01-05"] === 55, String(misto["2026-01-05"]));

console.log(fail === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
